const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "memories";

let memories = [];

function ensureShorts() {
  const used = new Set();
  let max = 0;

  // First pass: keep existing valid shorts, drop duplicates
  for (const m of memories) {
    if (m.short && /^mem\d+$/.test(m.short) && !used.has(m.short)) {
      used.add(m.short);
      max = Math.max(max, parseInt(m.short.slice(3), 10));
    } else {
      m.short = "";
    }
  }

  // Second pass: assign new shorts to anything missing
  for (const m of memories) {
    if (!m.short) {
      do { max++; } while (used.has(`mem${max}`));
      m.short = `mem${max}`;
      used.add(m.short);
    }
  }
}


let editingId = null;

async function load() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  memories = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  ensureShorts();
  await persist();
}

async function persist() {
  await chrome.storage.local.set({ [STORAGE_KEY]: memories });
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function maxShortNum() {
  let max = 0;
  for (const m of memories) {
    const r = m.short && /^mem(\d+)$/.exec(m.short);
    if (r) max = Math.max(max, parseInt(r[1], 10));
  }
  return max;
}

function nextShort() {
  return `mem${maxShortNum() + 1}`;
}



function escape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function resetForm() {
  editingId = null;
  $("key").value = "";
  $("value").value = "";
  $("tags").value = "";
  $("saveBtn").textContent = "Save";
  $("cancelBtn").style.display = "none";
}

function render() {
  const q = $("search").value.trim().toLowerCase();
  const filtered = memories.filter((m) => {
    if (!q) return true;
    return `${m.key} ${m.value} ${(m.tags || []).join(" ")}`
      .toLowerCase()
      .includes(q);
  });

  $("count").textContent = memories.length;

  if (filtered.length === 0) {
    $("list").innerHTML = memories.length
      ? `<div class="empty">No memories match “${escape(q)}”.</div>`
      : `<div class="empty">
           No memories yet.<br />
           <span style="font-size:11px;">
             In DeepSeek chat, type <code>memory save</code> to remember the
             conversation, <code>memory save &lt;text&gt;</code> for one line,
             or use the form above.
           </span>
         </div>`;
    return;
  }

  $("list").innerHTML = filtered
    .map(
      (m) => `
        <div class="memory-item">
          <div class="key">
            <span class="code">${escape(m.short || "")}</span>
            ${escape(m.key)}
          </div>
          <div class="value">${escape(m.value)}</div>
          <div class="meta">
            ${m.tags?.length ? "tags: " + escape(m.tags.join(", ")) + " · " : ""}
            ${new Date(m.updatedAt).toLocaleString()}
          </div>
          <div class="actions">
            <button class="secondary" data-edit="${m.id}">Edit</button>
            <button class="danger" data-del="${m.id}">Delete</button>
          </div>
        </div>
      `
    )
    .join("");

  $("list").querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => editMemory(b.dataset.edit))
  );
  $("list").querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => deleteMemory(b.dataset.del))
  );
}

function editMemory(id) {
  const m = memories.find((x) => x.id === id);
  if (!m) return;
  editingId = id;
  $("key").value = m.key;
  $("value").value = m.value;
  $("tags").value = (m.tags || []).join(", ");
  $("saveBtn").textContent = "Update";
  $("cancelBtn").style.display = "inline-block";
  $("key").focus();
}

async function deleteMemory(id) {
  if (!confirm("Delete this memory?")) return;
  memories = memories.filter((m) => m.id !== id);
  await persist();
  render();
  if (editingId === id) resetForm();
}

$("saveBtn").addEventListener("click", async () => {
  const key = $("key").value.trim();
  const value = $("value").value.trim();
  const tags = $("tags")
    .value.split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (!key || !value) {
    alert("Key and value are required.");
    return;
  }

  if (editingId) {
    const m = memories.find((x) => x.id === editingId);
    if (m) {
      m.key = key;
      m.value = value;
      m.tags = tags;
      m.updatedAt = new Date().toISOString();
    }
  } else {
    memories.push({
      id: uid(),
      short: nextShort(),
      key,
      value,
      tags,
      updatedAt: new Date().toISOString(),
    });
  }

  await persist();
  resetForm();
  render();
});

$("cancelBtn").addEventListener("click", resetForm);
$("search").addEventListener("input", render);

$("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(memories, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `deepseek-memory-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$("importFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      const imported = Array.isArray(data)
        ? data
        : Array.isArray(data.memories)
        ? data.memories
        : null;
      if (!imported) throw new Error("Invalid format");

      const replace = confirm(
        "OK = REPLACE all memories. Cancel = MERGE with existing."
      );
      if (replace) {
        memories = imported.map(normalize);
      } else {
        imported.forEach((item) => {
          const m = normalize(item);
          const idx = memories.findIndex((x) => x.key === m.key);
          if (idx >= 0) memories[idx] = { ...memories[idx], ...m, id: memories[idx].id };
          else memories.push(m);
        });
      }
      ensureShorts();
      await persist();
      render();
    } catch (err) {
      alert("Import failed: " + err.message);
    }
    e.target.value = "";
  };
  reader.readAsText(file);
});

function normalize(item) {
  return {
    id: item.id || uid(),
    short: item.short || "",
    key: String(item.key || ""),
    value: String(item.value || ""),
    tags: Array.isArray(item.tags)
      ? item.tags
      : String(item.tags || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
    updatedAt: item.updatedAt || new Date().toISOString(),
  };
}

$("clearAllBtn").addEventListener("click", async () => {
  if (!confirm("Delete ALL memories?")) return;
  memories = [];
  await persist();
  render();
  resetForm();
});

$("copyPromptBtn").addEventListener("click", async () => {
  if (memories.length === 0) return alert("No memories to copy.");
  const lines = memories.map((m) => {
    const tags = m.tags?.length ? ` (tags: ${m.tags.join(", ")})` : "";
    return `- ${m.key}: ${m.value}${tags}`;
  });
  const block = `<user_memory>\n${lines.join("\n")}\n</user_memory>`;
  await navigator.clipboard.writeText(block);
  alert("Copied to clipboard.");
});

(async () => {
  await load();
  render();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]) {
      memories = changes[STORAGE_KEY].newValue || [];
      const before = memories.map((m) => m.short).join("|");
      ensureShorts();
      const after = memories.map((m) => m.short).join("|");
      if (before !== after) persist();
      render();
    }
  });
})();

/* ====== Settings ====== */
(async () => {
  const {
    apiKey = "",
    autoTimer = false,
    autoInject = true,
  } = await chrome.storage.local.get(["apiKey", "autoTimer", "autoInject"]);
  const el = $("apiKey");
  const cb = $("autoTimer");
  const injectCb = $("autoInject");
  if (el) el.value = apiKey;
  if (cb) cb.checked = !!autoTimer;
  if (injectCb) injectCb.checked = autoInject !== false;
})();

const apiKeyEl = $("apiKey");
if (apiKeyEl) {
  apiKeyEl.addEventListener("change", async (e) => {
    await chrome.storage.local.set({ apiKey: e.target.value.trim() });
  });
}

const autoTimerEl = $("autoTimer");
if (autoTimerEl) {
  autoTimerEl.addEventListener("change", async (e) => {
    await chrome.storage.local.set({ autoTimer: e.target.checked });
  });
}

const autoInjectEl = $("autoInject");
if (autoInjectEl) {
  autoInjectEl.addEventListener("change", async (e) => {
    await chrome.storage.local.set({ autoInject: e.target.checked });
  });
}

/* Scan the chat for things worth remembering (local only). */
const scanBtn = $("scanBtn");
if (scanBtn) {
  scanBtn.addEventListener("click", async () => {
    const oldLabel = scanBtn.textContent;
    scanBtn.disabled = true;
    scanBtn.textContent = "Scanning…";
    try {
      const active = await chrome.tabs.query({ active: true, currentWindow: true });
      const all = await chrome.tabs.query({});
      const candidates = [
        ...active,
        ...all.filter((t) => !active.some((a) => a.id === t.id)),
      ];

      // Try the tab you're looking at first, then any other tab that has the
      // content script (a tab with no script rejects immediately).
      let res = null;
      for (const tab of candidates) {
        if (!tab.id) continue;
        try {
          res = await chrome.tabs.sendMessage(tab.id, { type: "summarizeChat" });
          if (res) break;
        } catch {
          /* no content script in this tab — keep going */
        }
      }
      if (!res) {
        throw new Error(
          "No chat tab found. Open your DeepSeek chat and try again."
        );
      }
      if (!res.ok) throw new Error(res.error || "Scan failed on the page.");

      const n = (res.added?.length || 0) + (res.updated?.length || 0);
      if (n) {
        alert(
          `Remembered ${res.added?.length || 0} new, updated ${
            res.updated?.length || 0
          }:\n\n• ${(res.keys || []).join("\n• ")}`
        );
      } else {
        alert(
          `Nothing new worth remembering yet (scanned ${
            res.scanned || 0
          } snippets).\n\nSay something like "I prefer short answers, my name is …" first.`
        );
      }
      await load();
      render();
    } catch (err) {
      alert("Scan failed: " + err.message);
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = oldLabel;
    }
  });
}

