(() => {
  /* ============ CONFIG ============ */
  const TRIGGER_REGEXES = [
    /\bmemory\s+save\b/i,
    /\bmemory\s+update\b/i,
    /\bremember\s+this\b/i,
    /\bsave\s+to\s+memory\b/i,
    /#remember\b/i,
  ];
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

  async function getSettings() {
    const s = await chrome.storage.local.get(["apiKey", "autoTimer"]);
    return { apiKey: s.apiKey || "", autoTimer: !!s.autoTimer };
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
      : `<div class="dsmm-empty">No matching memories</div>`;
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
    document.execCommand("insertText", false, block);
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
    const tags = (m.tags || []).map((t) => String(t).toLowerCase());
    const hay = `${key} ${m.value || ""} ${tags.join(" ")}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (key === t) score += 5;
      else if (key.includes(t)) score += 3;
      else if (tags.some((g) => g === t)) score += 3;
      else if (hay.includes(t)) score += 1;
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
  function detectTrigger(text) {
    return !!text && TRIGGER_REGEXES.some((r) => r.test(text));
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
      toast("No DeepSeek API key set — open the sidebar to add one.", "warn");
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

    // bring mem N → expand in place, then resend
    if (/\bbring\s+mem/i.test(text)) {
      expandBringMem(text).then((expanded) => {
        if (expanded === text) return;
        e.preventDefault();
        e.stopPropagation();
        setNativeValue(el, expanded);
        el.focus();
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
        }, 60);
      });
      return;
    }

    // memory save / update
    if (detectTrigger(text)) {
      setTimeout(() => runCapture("save"), 1500);
    }
  }, true);

  document.addEventListener("mousedown", (e) => {
    if (box && !box.contains(e.target)) hideBox();
    if (matchPanel && !matchPanel.contains(e.target)) {
      const el = e.target;
      if (!el || el.tagName !== "TEXTAREA") hidePanel();
    }
  });

  /* optional timer capture */
  let timerId = null;
  async function refreshTimer() {
    const { autoTimer } = await getSettings();
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    if (autoTimer) {
      timerId = setInterval(() => runCapture("auto").catch(() => {}), AUTO_INTERVAL_MS);
    }
  }
  refreshTimer();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.autoTimer) refreshTimer();
  });;
})();