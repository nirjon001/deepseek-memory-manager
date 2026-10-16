# DeepSeek Memory Manager

Local-first memory for [chat.deepseek.com](https://chat.deepseek.com) — a Chrome/Edge (Manifest V3) extension that remembers things about you and puts them back into your chats.

**No API key, no account, no cost.** Everything works offline against `chrome.storage.local`. An optional DeepSeek API key only adds automatic extraction from conversations.

## Features

- **Remember things instantly** — type `memory save <text>` in the chat box and it is stored locally. No API key needed.
- **`/mem` search in chat** — type `/mem ` to search your memories in a dropdown; press Enter to insert the memory as a `<user_memory>` block.
- **`bring mem`** — type `bring mem 1` (or `bring mem 1, 3`) and the placeholder is replaced with the actual memory text before the message is sent.
- **Side panel manager** — add, edit, search, delete, import/export memories next to your chat.
- **Copy block** — put every memory into a single `<user_memory>` block on the clipboard.
- **Optional auto-extraction** — with a DeepSeek API key, the extension can read a conversation and propose/merge memories automatically (`Auto-extract` in the side panel).

## Commands (typed in the DeepSeek chat box)

| Command | What it does |
| --- | --- |
| `memory save <text>` | Saves `<text>` as a new memory (key derived from the text) |
| `memory save <key> = <text>` | Saves with an explicit key, e.g. `memory save editor = VS Code` |
| `memory update <key> = <text>` | Overwrites the value of an existing memory |
| `remember this <text>` | Alias for `memory save <text>` |
| `/mem <query>` | Searches memories and inserts the picked one |
| `bring mem 1, 2` | Inlines memories `mem1` and `mem2` into the message |

Commands are consumed locally — they are **not** sent to the model. Normal messages are unaffected.

Handy: each memory gets a short code (`mem1`, `mem2`, …) shown in the side panel and the `/mem` dropdown.

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

- Click the toolbar icon to open the memory side panel. It shows the memory count, and lets you add/edit/delete entries and export/import JSON.
- Memories live in `chrome.storage.local`: they stay on your machine and are never uploaded.
- If the panel shows "No memories yet", that just means the store is empty — add one in the form, or type `memory save <text>` in chat.
- The DeepSeek API key field is **optional**. Leave it blank if you don't have one; only `Auto-extract` requires it.

## Project structure

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest (permissions, side panel, content scripts) |
| `background.js` | Service worker: message pass-through + optional API extraction |
| `content.js` / `content.css` | Injected into chat.deepseek.com: `/mem` dropdown, `memory save`/`update`, `bring mem`, toasts |
| `sidepanel.html/css/js` | Memory manager UI (CRUD, search, import/export, settings) |

## License

MIT
