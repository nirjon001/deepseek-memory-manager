# DeepSeek Memory Manager

Local-first memory for [chat.deepseek.com](https://chat.deepseek.com) — a Chrome/Edge (Manifest V3) extension that remembers what matters from your conversations and brings it back **automatically when the topic comes up again**.

**No API key, no cost, no network calls.** Summarisation, matching and injection all run locally in the page.

## How it works

```
 you type          the extension                        deepseek sees
─────────         ─────────────────────────────        ──────────────────────────
 "I prefer ..." → remembers the turn locally
                                              ↘
 "write it        topic match detected      → prepends <user_memory>…</user_memory>
  concisely"                                   to your message, sends it like
                                               you typed it
```

1. **Capture** — every message you send is stored in a local buffer (plus the assistant's visible text).
2. **Summarise** — `memory save` runs a local extractive scorer over that buffer: it picks statements worth keeping ("I prefer…", "my name is…", "I work on…", always/never rules) and stores them as memories with a derived key. No LLM is involved.
3. **Recall** — when you send a message whose topic matches a memory, the relevant memories are prepended to your message inside `<user_memory>` so DeepSeek answers as if it already knew this from before.

You see exactly what happened: a toast names the memories that were added.

## Commands (typed in the DeepSeek chat box)

| Command | What it does |
| --- | --- |
| `memory save` | **Summarise the current chat and remember the important parts** (local) |
| `memory save <text>` | Save one line as a memory (key derived from the text) |
| `memory save <key> = <text>` | Save with an explicit key, e.g. `memory save editor = VS Code` |
| `memory update <key> = <text>` | Overwrite an existing memory |
| `memory summarize` / `memory scan` | Same as bare `memory save` |
| `remember this <text>` | Alias for `memory save <text>` |
| `memory extract` | *Optional* DeepSeek-API extraction of the conversation (only with a key) |
| `/mem <query>` | Search memories and insert the picked one |
| `bring mem 1, 2` | Inline memories `mem1` and `mem2` into the message |

Commands are consumed locally — they are **never** sent to the model. Normal messages are unaffected.

## Side panel controls

| Control | Default | What it does |
| --- | --- | --- |
| **Add matching memories to my messages** | on | Auto-inject on topic match (max 3, score-gated) |
| **Auto-remember important things every 5 min** | off | Runs the local summariser on a timer |
| **Scan this chat now** | — | Summarise on demand from the panel |
| DeepSeek API key | empty | Only needed for `memory extract` |

## Why this will not get your account banned

Bans come from **talking to DeepSeek's private endpoints** — the reverse-engineered chat/stream APIs, scripted logins, token reuse, and bulk automation. That is what `deepseek-pp`-style tools do, and it is why accounts get flagged.

This extension deliberately never does any of that:

- ❌ No calls to `chat.deepseek.com`'s internal or undocumented endpoints
- ❌ No scripted login, no session/token automation, no scraping of other users
- ❌ No background bulk generation
- ✅ Only reads text the page already rendered, and types into the composer
- ✅ A sent message is byte-for-byte identical to something you could have typed yourself
- ✅ The one network feature that exists (`memory extract`) uses the **official, documented** `api.deepseek.com` REST API with **your own key** — and it is entirely optional

The extension never sends your data anywhere else either: memories live in `chrome.storage.local`.

## Features

- **Summarise instead of copy-paste** — `memory save` pulls the important lines out of the conversation for you.
- **Automatic recall** — matching memories are injected into your next message; a floating panel also shows matches while you type (turn auto-inject off to use it manually).
- **`/mem` search in chat** — type `/mem ` for a dropdown; Enter inserts a `<user_memory>` block.
- **`bring mem`** — `bring mem 1` (or `bring mem 1, 3`) is replaced with the memory text before sending.
- **Side panel manager** — add, edit, search, delete, import/export memories.
- **Copy block** — put every memory into one `<user_memory>` block on the clipboard.
- **Optional API extraction** — with your own key, `memory extract` proposes/merges memories from the whole conversation.

Each memory gets a short code (`mem1`, `mem2`, …) shown in the side panel and the `/mem` dropdown.

## Install (developer mode)

1. Clone this repo:
   ```bash
   git clone https://github.com/nirjon001/deepseek-memory-manager.git
   ```
2. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this folder.
5. Open [chat.deepseek.com](https://chat.deepseek.com) and pin the extension to the toolbar.

After pulling updates, hit **Reload** on the extension card.

## Usage notes

- Click the toolbar icon to open the memory side panel.
- Memories live in `chrome.storage.local`: they stay on your machine and are never uploaded.
- Try it in one minute: chat normally, type `memory save`, then ask about the same topic again.
- The DeepSeek API key field is **optional** and never required for anything else.

## Project structure

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest (permissions, side panel, content scripts) |
| `background.js` | Service worker: message pass-through + optional API extraction |
| `content.js` / `content.css` | Injected into chat.deepseek.com: local summariser, auto-inject, `/mem` dropdown, `memory save`/`update`, `bring mem`, toasts |
| `sidepanel.html/css/js` | Memory manager UI (CRUD, search, import/export, automation settings) |

## License

MIT
