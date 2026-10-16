(() => {
  /* ============ CONFIG ============ */
  const MAX_RESULTS = 8;
  const AUTO_INTERVAL_MS = 5 * 60 * 1000;
  const MIN_TOKEN_LEN = 3;
  const MAX_MATCHES = 5;

  const STOPWORDS = new Set([
    "the","and","for","you","are","but","not","with","this","that","from","have",
    "will","your","can","what","when","where","which","how","all","any","some",
    "use","using","get","got","was","were","been","being","has","had","its","it's",
    "into","than","then","them","they","their","there","here","just","only","also",
    "very","more","most","such","like","make","made","say","said","tell","told",
    "ask","asked","new","old","now","over","out","off","own","other","another",
    "each","every","both","either","neither","few","many","much","one","two",
    "three","about","after","before","under","above","between","during","through",
    "while","because","since","until","unless","however","though","although",
    "whether","should","would","could","might","must","may",
  ]);

  /* ============ helpers ============ */
  const esc = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  /* ============ cached settings + memories ============
     The Enter/send path must decide synchronously whether to inject a
     memory, so we keep a mirror of storage in memory and refresh it on
     every storage change. */
  let memCache = [];
  let settings = { apiKey: "", autoTimer: false, autoInject: true };

  async function refreshCache() {
    const s = await chrome.storage.local.get([
      "memories",
      "apiKey",
      "autoTimer",
      "autoInject",
    ]);
    memCache = Array.isArray(s.memories) ? s.memories : [];
    settings = {
      apiKey: s.apiKey || "",
      autoTimer: !!s.autoTimer,
      autoInject: s.autoInject !== false, // on by default
    };
    return settings;
  }
  refreshCache();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") refreshCache();
  });

  async function getSettings() {
    return refreshCache();
  }

  async function getMemories() {
    const { memories = [] } = await chrome.storage.local.get("memories");
    return Array.isArray(memories) ? memories : [];
  }

  async function setMemories(memories) {
    await chrome.storage.local.set({ memories });
  }

  function setNativeValue(el, value) {
    const proto =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ============ /mem search dropdown ============ */
  const TRIGGER = "/mem ";
  let box = null;
  let items = [];
  let activeIdx = 0;
  let ctx = null;
  let noMemoriesYet = false;

  function makeBox() {
    if (box) return box;
    box = document.createElement("div");
    box.id = "dsmm-dropdown";
    document.body.appendChild(box);
    return box;
  }
  function hideBox() {
    if (box) box.style.display = "none";
    ctx = null;
    items = [];
    activeIdx = 0;
  }
  function renderBox(el) {
    const rect = el.getBoundingClientRect();
    box.style.left = `${rect.left}px`;
    box.style.width = `${Math.max(rect.width, 320)}px`;
    box.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    box.innerHTML = items.length
      ? items
          .map(
            (m, i) => `
        <div class="dsmm-item ${i === activeIdx ? "active" : ""}" data-idx="${i}">
          <div class="dsmm-key"><span class="dsmm-code">${esc(m.short || "")}</span> ${esc(m.key)}</div>
          <div class="dsmm-val">${esc(m.value)}</div>
          ${m.tags?.length ? `<div class="dsmm-tags">${esc(m.tags.join(" · "))}</div>` : ""}
        </div>`
          )
          .join("")
      : `<div class="dsmm-empty">${
          noMemoriesYet
            ? "No memories yet — type memory save &lt;your note&gt; in chat, or use the side panel."
            : "No matching memories"
        }</div>`;
    box.querySelectorAll(".dsmm-item").forEach((n) =>
      n.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pick(Number(n.dataset.idx));
      })
    );
    box.style.display = "block";
  }
  function pick(i) {
    if (!ctx || !items[i]) return;
    const m = items[i];
    const block = `<user_memory>\n- ${m.key}: ${m.value}\n</user_memory>`;
    const el = ctx.el;
    el.focus();
    el.setSelectionRange(ctx.start, ctx.end);
    const inserted = document.execCommand("insertText", false, block);
    if (!inserted) {
      // execCommand can refuse (e.g. no editable focus) — fall back to a
      // React-compatible value swap so the composer still updates.
      setNativeValue(el, el.value.slice(0, ctx.start) + block + el.value.slice(ctx.end));
      el.setSelectionRange(ctx.start + block.length, ctx.start + block.length);
    }
    hideBox();
  }
  async function onInput(e) {
    const el = e.target;
    if (!el || el.tagName !== "TEXTAREA") return;
    const value = el.value;
    const pos = el.selectionStart ?? value.length;
    const before = value.slice(0, pos);
    const idx = before.lastIndexOf(TRIGGER);
    if (idx === -1 || (idx > 0 && !/\s/.test(before[idx - 1]))) {
      hideBox();
      return;
    }
    const query = before.slice(idx + TRIGGER.length);
    if (query.includes("\n")) {
      hideBox();
      return;
    }
    ctx = { el, start: idx, end: pos, query: query.trim() };
    const memories = await getMemories();
    noMemoriesYet = memories.length === 0;
    const q = ctx.query.toLowerCase();
    items = memories
      .filter((m) =>
        q
          ? `${m.key} ${m.value} ${(m.tags || []).join(" ")}`
              .toLowerCase()
              .includes(q)
          : true
      )
      .slice(0, MAX_RESULTS);
    activeIdx = 0;
    makeBox();
    renderBox(el);
  }

  /* ============ auto-match floating panel ============ */
  let matchPanel = null;
  function ensurePanel() {
    if (matchPanel) return matchPanel;
    matchPanel = document.createElement("div");
    matchPanel.id = "dsmm-matches";
    document.body.appendChild(matchPanel);
    return matchPanel;
  }
  function hidePanel() {
    if (matchPanel) matchPanel.style.display = "none";
  }
  function tokenize(text) {
    return String(text)
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((t) => t.length >= MIN_TOKEN_LEN && !STOPWORDS.has(t));
  }
  function scoreMemory(m, tokens) {
    const key = String(m.key || "").toLowerCase();
    const keyWords = key.split(/[\s_-]+/).filter(Boolean);
    const tags = (m.tags || []).map((t) => String(t).toLowerCase());
    const hayWords = `${key} ${m.value || ""} ${tags.join(" ")}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    let score = 0;
    for (const t of tokens) {
      const st = stem(t);
      if (key === t) score += 5;
      else if (keyWords.some((w) => stem(w) === st)) score += 4;
      else if (tags.some((g) => stem(g) === st)) score += 3;
      else if (hayWords.some((w) => stem(w) === st)) score += 1;
    }
    return score;
  }
  async function updateMatches(text, el) {
    if (!text || text.length < 3 || /\/mem\s|\bbring\s+mem/i.test(text)) {
      hidePanel();
      return;
    }
    const tokens = tokenize(text);
    if (!tokens.length) {
      hidePanel();
      return;
    }
    const memories = await getMemories();
    const scored = memories
      .map((m) => ({ m, score: scoreMemory(m, tokens) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_MATCHES);
    if (!scored.length) {
      hidePanel();
      return;
    }
    const panel = ensurePanel();
    panel.innerHTML = `
      <div class="dsmm-matches-title">Matched memories</div>
      ${scored
        .map(
          ({ m }) => `
        <div class="dsmm-match" data-id="${m.id}">
          <span class="dsmm-match-code">${esc(m.short || "mem?")}</span>
          <span class="dsmm-match-key">${esc(m.key)}</span>
          <span class="dsmm-match-val">${esc(
            (m.value || "").slice(0, 70)
          )}${(m.value || "").length > 70 ? "…" : ""}</span>
        </div>`
        )
        .join("")}
      <div class="dsmm-matches-hint">
        Click to insert · or type
        <code>bring ${scored
          .map((s) => s.m.short)
          .filter(Boolean)
          .slice(0, 3)
          .join(", ")}</code>
      </div>
    `;
    panel.style.display = "block";
    panel.querySelectorAll(".dsmm-match").forEach((node) =>
      node.addEventListener("mousedown", async (e) => {
        e.preventDefault();
        const m = (await getMemories()).find((x) => x.id === node.dataset.id);
        if (!m) return;
        const block = `<user_memory>\n- ${m.key}: ${m.value}\n</user_memory>`;
        const pos = el.selectionStart ?? el.value.length;
        const before = el.value.slice(0, pos);
        const after = el.value.slice(pos);
        setNativeValue(el, before + block + after);
        el.setSelectionRange(pos + block.length, pos + block.length);
        el.focus();
      })
    );
  }

  /* ============ bring mem N ============ */
  async function expandBringMem(text) {
    const re = /\bbring\s+((?:(?:mem\s*)?\d+\s*[,、 ]?\s*)+)/gi;
    const memories = await getMemories();
    let changed = false;
    const out = text.replace(re, (match, group) => {
      const nums = group.match(/\d+/g) || [];
      const picked = nums
        .map((n) => memories.find((m) => m.short === `mem${n}`))
        .filter(Boolean);
      if (!picked.length) return match;
      changed = true;
      return (
        `<user_memory>\n` +
        picked.map((m) => `- ${m.key}: ${m.value}`).join("\n") +
        `\n</user_memory>`
      );
    });
    return changed ? out : text;
  }

  /* ============ auto memory capture ============ */
  function scrapeConversation(maxMessages = 8) {
    const selectors = [
      '[class*="chat-message"]',
      '[class*="message-container"]',
      '[data-message-author-role]',
      'div[class*="markdown"]',
    ];
    let nodes = [];
    for (const sel of selectors) {
      nodes = Array.from(document.querySelectorAll(sel));
      if (nodes.length >= 2) break;
    }
    if (!nodes.length) return "";
    const collected = [];
    const seen = new Set();
    for (const n of nodes) {
      const text = (n.innerText || "").trim();
      if (!text || text.length < 3) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      collected.push(text);
    }
    return collected.slice(-maxMessages).join("\n\n---\n\n");
  }
  async function extractMemoriesFromConversation(apiKey, conversation) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "extractMemories", apiKey, conversation },
        (resp) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (!resp || !resp.ok) {
            return reject(new Error(resp?.error || "Extraction failed"));
          }
          resolve(resp.memories || []);
        }
      );
    });
  }

  function nextShort(memories) {
    let max = 0;
    memories.forEach((m) => {
      const r = m.short && /^mem(\d+)$/.exec(m.short);
      if (r) max = Math.max(max, parseInt(r[1], 10));
    });
    return `mem${max + 1}`;
  }

  async function mergeMemories(extracted) {
    const existing = await getMemories();
    const added = [];
    const updated = [];
    for (const e of extracted) {
      if (!e || !e.key || !e.value) continue;
      const key = String(e.key).trim();
      const value = String(e.value).trim();
      const tags = Array.isArray(e.tags) ? e.tags : [];
      const idx = existing.findIndex(
        (m) => m.key.toLowerCase() === key.toLowerCase()
      );
      if (idx >= 0) {
        if (existing[idx].value !== value) {
          existing[idx].value = value;
          existing[idx].tags = tags.length ? tags : existing[idx].tags;
          existing[idx].updatedAt = new Date().toISOString();
          updated.push(key);
        }
      } else {
        existing.push({
          id: uid(),
          short: nextShort(existing),
          key,
          value,
          tags,
          updatedAt: new Date().toISOString(),
        });
        added.push(key);
      }
    }
    await setMemories(existing);
    return { added, updated };
  }

  /* ============ local commands: `memory save` / `memory update` ============
     Fully offline — no API key, no network. Reads/writes chrome.storage only.

       memory save I prefer concise English answers
       memory save preferred_language = I prefer concise English
       memory update editor = VS Code with the Copilot extension
       remember this <note>          (same behaviour)
     ---------------------------------------------------------------------- */
  const CMD_RE = /\b(memory\s+(?:save|update|summarize|summarise|scan|extract)|remember\s+this|save\s+to\s+memory|#remember)\b/i;

  function parseCommand(text) {
    const m = CMD_RE.exec(text || "");
    if (!m) return null;
    const rest = text.slice(m.index + m[0].length);
    const body = rest.replace(/^[\s:：=、,-]+/, "");
    let key = "";
    let value = body.trim();
    const kv = /^([A-Za-z0-9_][A-Za-z0-9_ \-]{0,30}?)\s*[:：=]\s*([\s\S]+)$/.exec(body.trim());
    if (kv) {
      key = kv[1].trim();
      value = kv[2].trim();
    }
    const verb = ((m[1] || "").match(/(save|update|summarize|summarise|scan|extract)/i) || [])[1];
    let action = "save";
    if (/^update$/i.test(verb || "")) action = "update";
    else if (/^extract$/i.test(verb || "")) action = "extract";
    else if (/^(summarize|summarise|scan)$/i.test(verb || "")) action = "summarize";
    // `memory save` on its own = "remember what we just talked about"
    if (action === "save" && !value && !key) action = "summarize";
    return { action, key, value, start: m.index, end: text.length };
  }

  function deriveKey(value) {
    const slug = String(value)
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]+/g, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join("_")
      .replace(/^_+|_+$/g, "");
    return (slug || "note").slice(0, 40);
  }

  async function applyCommand(cmd) {
    const memories = await getMemories();
    const key = cmd.key || deriveKey(cmd.value);
    const idx = memories.findIndex(
      (m) => String(m.key || "").toLowerCase() === key.toLowerCase()
    );
    const now = new Date().toISOString();
    let entry;
    if (idx >= 0) {
      entry = memories[idx];
      entry.value = cmd.value;
      entry.updatedAt = now;
    } else {
      entry = {
        id: uid(),
        short: nextShort(memories),
        key,
        value: cmd.value,
        tags: ["chat"],
        updatedAt: now,
      };
      memories.push(entry);
    }
    await setMemories(memories);
    return { outcome: idx >= 0 ? "updated" : "saved", short: entry.short, key: entry.key };
  }

  async function handleCommand(cmd, el) {
    const clearComposer = () => {
      setNativeValue(
        el,
        (el.value.slice(0, cmd.start) + el.value.slice(cmd.end)).trim()
      );
      el.focus();
    };
    try {
      if (cmd.action === "summarize") {
        const res = await summarizeConversation();
        const n = res.added.length + res.updated.length;
        if (!n) {
          toast(
            "Nothing new to remember yet — chat a bit more, then type memory save again.",
            "warn"
          );
        } else {
          const bits = [];
          if (res.added.length) bits.push(`${res.added.length} new`);
          if (res.updated.length) bits.push(`${res.updated.length} updated`);
          toast(`Remembered ${bits.join(", ")} — ${res.keys.slice(0, 3).join(", ")}`, "ok");
        }
        clearComposer();
        return;
      }
      if (cmd.action === "extract") {
        clearComposer();
        runCapture("extract");
        return;
      }
      if (!cmd.value) {
        toast(
          "Nothing to save. Try: memory save I prefer concise English answers",
          "warn"
        );
        return;
      }
      const res = await applyCommand(cmd);
      toast(
        `${res.outcome === "updated" ? "Updated" : "Saved"} ${res.short} · ${res.key}`,
        "ok"
      );
      clearComposer();
    } catch (err) {
      toast("Could not save: " + err.message, "warn");
    }
  }

  /* ============ local summariser — no LLM, no network, no API key ============
     Pulls the "worth remembering" statements out of the conversation with
     plain heuristics: timing/attribution cues ("I prefer", "my name is"),
     first-person facts, and words that keep coming back. Works on a buffer
     of what you actually typed plus the assistant's visible text, so it
     never needs to talk to DeepSeek's private endpoints (which is what gets
     accounts banned).
     ---------------------------------------------------------------------- */
  const MAX_CAPTURE = 5;
  const MAX_TURNS = 25;
  const MAX_INJECT = 3;
  const INJECT_MIN_SCORE = 4;

  const MEM_CUES = [
    /\bremember (that|this)\b/i,
    /\b(my name is|call me)\b/i,
    /\bi (prefer|like|love|hate|dislike|use|need|want|work|live|study)\b/i,
    /\bmy (name|goal|job|role|company|project|team|timezone|language|editor|stack|os|setup|workflow|preference|background|deadline)\b/i,
    /\b(always|never|usually|by default|from now on|going forward)\b/i,
    /\b(don'?t|do not) (use|want|like)\b/i,
    /\bi'?m (a|an|working|building|learning|trying)\b/i,
  ];

  const stem = (t) => String(t).toLowerCase().slice(0, 5);

  function tokenSet(text) {
    return new Set(tokenize(text));
  }

  function similarity(a, b) {
    const A = tokenSet(a);
    const B = tokenSet(b);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    for (const t of A) if (B.has(t)) inter++;
    return inter / (A.size + B.size - inter);
  }

  function splitSentences(text) {
    return String(text)
      .split(/(?<=[.!?。！？])\s+|\n+/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }

  function scoreSentence(s, df) {
    if (s.length < 15 || s.length > 240) return 0;
    if (/^[\W\d]*(ok|okay|thanks|thank you|yes|no|sure|great|cool|hi|hello|hey|wow)[\s!.,?]*$/i.test(s)) {
      return 0; // filler only when that is all the sentence says
    }
    if (/\?\s*$/.test(s)) return 0; // a question is not a fact
    // nor is a sentence that opens like one ("what is my name again")
    if (
      /^(what|why|how|when|where|who|which|is|are|was|were|do|does|did|can|could|should|would|will|shall|may|might|has|have|had)\b/i.test(s)
    ) {
      return 0;
    }
    if (/```|[{}]{2,}|\b(function|const|def|class)\b/.test(s)) return 0; // code noise
    let score = 0;
    if (MEM_CUES.some((re) => re.test(s))) score += 6;
    if (/\b(i|my|me|we|our|mine)\b/i.test(s)) score += 3;
    let salient = 0;
    for (const tok of tokenSet(s)) {
      if (tok.length >= 4 && (df.get(tok) || 0) >= 2) salient++;
    }
    score += Math.min(salient, 3);
    if (s.length >= 40 && s.length <= 180) score += 1;
    return score;
  }

  function keyFromSentence(s) {
    const stripped = s
      .replace(/^(please\s+)?(remember\s+(that\s+|this\s+)?|note\s+that\s+)/i, "")
      .replace(/^my\s+/i, "")
      .replace(/^i\s+(prefer|like|love|hate|dislike|use|need|want|am|'m)\s+/i, "")
      .replace(/[.!?]+$/, "");
    return deriveKey(stripped);
  }

  async function getRecentTurns() {
    const { recentTurns = [] } = await chrome.storage.local.get("recentTurns");
    return Array.isArray(recentTurns) ? recentTurns : [];
  }

  async function pushRecentTurn(text) {
    const t = String(text || "").trim();
    if (t.length < 12) return;
    const turns = await getRecentTurns();
    if (turns.length && similarity(turns[turns.length - 1].text, t) > 0.8) return;
    turns.push({ text: t, at: new Date().toISOString() });
    while (turns.length > MAX_TURNS) turns.shift();
    await chrome.storage.local.set({ recentTurns: turns });
  }

  // Best-effort DOM reading. Both selectors lists are deliberately tolerant:
  // DeepSeek renames classes on every deploy, so we try a few shapes and take
  // the first that yields anything.
  function scrapeText(selectors, { minLen = 40, max = 6 } = {}) {
    for (const sel of selectors) {
      let nodes;
      try {
        nodes = Array.from(document.querySelectorAll(sel));
      } catch {
        continue;
      }
      const texts = nodes
        .map((n) => (n.innerText || "").trim())
        .filter((t) => t.length >= minLen);
      if (texts.length) return texts.slice(-max);
    }
    return [];
  }

  function scrapeAssistant() {
    return scrapeText(['div[class*="ds-markdown"]', '[class*="markdown"]'], {
      minLen: 40,
      max: 6,
    });
  }

  function scrapeUserMessages() {
    return scrapeText(
      [
        '[data-role="user"]',
        '[class*="user-message"]',
        '[class*="userMessage"]',
        '[class*="user-bubble"]',
      ],
      { minLen: 15, max: 6 }
    );
  }

  async function collectConversation() {
    const turns = await getRecentTurns();
    const msgs = turns.map((t) => ({ role: "user", text: t.text }));
    // Page text fills the gaps (e.g. turns made before the browser restarted).
    for (const u of scrapeUserMessages()) msgs.push({ role: "user", text: u });
    for (const a of scrapeAssistant()) msgs.push({ role: "assistant", text: a });
    return msgs;
  }

  async function summarizeConversation() {
    const existing = await getMemories();
    const msgs = await collectConversation();
    if (!msgs.length) return { added: [], updated: [], keys: [], scanned: 0 };

    const sentences = [];
    for (const m of msgs) {
      for (const s of splitSentences(m.text)) sentences.push({ role: m.role, text: s });
    }

    const df = new Map();
    for (const { text } of sentences) {
      for (const tok of tokenSet(text)) df.set(tok, (df.get(tok) || 0) + 1);
    }

    const scored = sentences
      .map((s) => ({
        ...s,
        score: scoreSentence(s.text, df) + (s.role === "user" ? 2 : 0),
      }))
      .filter((s) => s.score >= 6)
      .sort((a, b) => b.score - a.score);

    const picked = [];
    for (const c of scored) {
      if (picked.some((p) => similarity(p.text, c.text) > 0.6)) continue;
      if (existing.some((m) => similarity(m.value, c.text) > 0.6)) continue;
      picked.push(c);
      if (picked.length >= MAX_CAPTURE) break;
    }
    if (!picked.length) return { added: [], updated: [], keys: [], scanned: sentences.length };

    const now = new Date().toISOString();
    const added = [];
    const updated = [];
    const keys = [];
    for (const p of picked) {
      const key = keyFromSentence(p.text);
      const idx = existing.findIndex(
        (m) => String(m.key).toLowerCase() === key.toLowerCase()
      );
      if (idx >= 0) {
        if (existing[idx].value !== p.text) {
          existing[idx].value = p.text;
          existing[idx].updatedAt = now;
          updated.push(existing[idx].short);
          keys.push(existing[idx].key);
        }
      } else {
        const entry = {
          id: uid(),
          short: nextShort(existing),
          key,
          value: p.text,
          tags: ["auto"],
          updatedAt: now,
        };
        existing.push(entry);
        added.push(entry.short);
        keys.push(entry.key);
      }
    }
    if (added.length || updated.length) await setMemories(existing);
    return { added, updated, keys, scanned: sentences.length };
  }

  // Which memories are relevant to what the user is about to send?
  function pickMemoriesFor(text) {
    const tokens = tokenize(text);
    if (!tokens.length) return [];
    return memCache
      .map((m) => ({ m, score: scoreMemory(m, tokens) }))
      .filter((x) => x.score >= INJECT_MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_INJECT)
      .map((x) => x.m);
  }

  function memoryBlock(list, withKeys = true) {
    const lines = list.map((m) =>
      withKeys ? `- ${m.key}: ${m.value}` : `- ${m.value}`
    );
    return `<user_memory>\n${lines.join("\n")}\n</user_memory>`;
  }

  // Swallow the current Enter and re-dispatch it once the composer has been
  // rewritten, guarded by a flag so the handler cannot loop on itself.
  function resendEnter(el) {
    el.dataset.dsmmResend = "1";
    setTimeout(() => {
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        })
      );
      delete el.dataset.dsmmResend;
    }, 60);
  }

  function toast(msg, kind = "info") {
    const el = document.createElement("div");
    el.className = `dsmm-toast dsmm-toast-${kind}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add("show"), 10);
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 300);
    }, 3200);
  }

  async function runCapture(reason) {
    const { apiKey } = await getSettings();
    if (!apiKey) {
      toast(
        "`memory extract` needs a DeepSeek API key (optional). `memory save` works offline — try that.",
        "warn"
      );
      return;
    }
    const convo = scrapeConversation(10);
    if (!convo) {
      toast("Couldn't read conversation from page.", "warn");
      return;
    }
    toast("Reading conversation…");
    try {
      const extracted = await extractMemoriesFromConversation(apiKey, convo);
      if (!extracted.length) {
        toast("Nothing worth saving.", "info");
        return;
      }
      const { added, updated } = await mergeMemories(extracted);
      const bits = [];
      if (added.length) bits.push(`+${added.length} new`);
      if (updated.length) bits.push(`~${updated.length} updated`);
      toast(`Memory ${reason}: ${bits.join(", ") || "no change"}`, "ok");
    } catch (err) {
      toast("Memory extraction failed: " + err.message, "warn");
    }
  }

  /* ============ event wiring ============ */
  document.addEventListener("input", (e) => {
    onInput(e);
    const el = e.target;
    if (el && el.tagName === "TEXTAREA") updateMatches(el.value, el);
  }, true);

  document.addEventListener("keydown", (e) => {
    // Handle /mem dropdown navigation first
    if (box && box.style.display !== "none") {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeIdx = Math.min(activeIdx + 1, items.length - 1);
        renderBox(ctx.el);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIdx = Math.max(activeIdx - 1, 0);
        renderBox(ctx.el);
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        if (!items.length) return;
        e.preventDefault();
        e.stopPropagation();
        pick(activeIdx);
        return;
      }
      if (e.key === "Escape") {
        hideBox();
        return;
      }
    }

    if (e.key !== "Enter" || e.shiftKey) return;
    const el = e.target;
    if (!el || el.tagName !== "TEXTAREA") return;
    const text = el.value;

    // bring mem N → expand in place, then resend the expanded text.
    // IMPORTANT: block the original Enter *synchronously* — expanding needs an
    // async storage read, and by the time it resolves the message would already
    // have been sent.
    if (!el.dataset.dsmmResend && /\bbring\s+mem/i.test(text)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      expandBringMem(text).then((expanded) => {
        setNativeValue(el, expanded);
        el.focus();
        resendEnter(el);
      });
      return;
    }

    // memory save / memory update — stored locally and never sent to the model
    const cmd = parseCommand(text);
    if (cmd) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      handleCommand(cmd, el);
      return;
    }

    // Remember what the user actually said so `memory save` can summarise it.
    if (!el.dataset.dsmmResend) pushRecentTurn(text).catch(() => {});

    // Topic match → put the relevant memories into the outgoing message so
    // DeepSeek answers as if it already knew this from before.
    if (
      settings.autoInject &&
      !el.dataset.dsmmResend &&
      !/<user_memory>/i.test(text)
    ) {
      const picked = pickMemoriesFor(text);
      if (picked.length) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setNativeValue(el, memoryBlock(picked) + "\n" + text);
        el.focus();
        resendEnter(el);
        toast(
          `Added ${picked.length} ${picked.length === 1 ? "memory" : "memories"} to this message`,
          "info"
        );
        return;
      }
    }
  }, true);

  document.addEventListener("mousedown", (e) => {
    if (box && !box.contains(e.target)) hideBox();
    if (matchPanel && !matchPanel.contains(e.target)) {
      const el = e.target;
      if (!el || el.tagName !== "TEXTAREA") hidePanel();
    }
  });

  /* auto-capture: run the local summariser every 5 minutes — no API key */
  let timerId = null;
  async function refreshTimer() {
    const { autoTimer } = await getSettings();
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    if (autoTimer) {
      timerId = setInterval(() => {
        summarizeConversation()
          .then((res) => {
            if (res.added.length || res.updated.length) {
              toast(
                `Auto-remembered ${res.added.length} new (${res.keys.slice(0, 2).join(", ")})`,
                "info"
              );
            }
          })
          .catch(() => {});
      }, AUTO_INTERVAL_MS);
    }
  }
  refreshTimer();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.autoTimer) refreshTimer();
  });

  /* side panel → "Scan this chat" button */
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "summarizeChat") return;
    summarizeConversation()
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  });
})();