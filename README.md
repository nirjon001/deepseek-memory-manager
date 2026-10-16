# DeepSeek Memory Manager

A Chrome (Manifest V3) extension that gives [chat.deepseek.com](https://chat.deepseek.com) a persistent memory layer: a side panel to manage memories, a `/mem` in-chat search trigger, and automatic memory capture powered by the DeepSeek API.

## Features

- **Side panel memory manager** — add, search, edit, and delete key/value memories with tags, right next to your chat.
- **`/mem` search dropdown** — type `/mem ` in the DeepSeek chat box to search and insert memories without leaving the keyboard.
- **`bring mem` expansion** — references to saved memories expand into a ready-to-send `<user_memory>` block (one-click "Copy full block" in the side panel too).
- **Automatic memory capture** — extracts and merges durable facts from your recent conversation via the DeepSeek API, with an optional auto-capture timer.
- **Import / Export** — back up or migrate all memories as JSON; clear everything with one click.
- **Local & private** — memories are stored in `chrome.storage.local`; your API key never leaves your browser except in requests you trigger to `api.deepseek.com`.

## Install (manual / developer mode)

1. Clone this repo:
   ```bash
   git clone https://github.com/nirjon001/deepseek-memory-manager.git
   ```
2. Open `chrome://extensions` in Chrome (or any Chromium browser).
3. Toggle **Developer mode** (top right).
4. Click **Load unpacked** and select this folder.
5. Open [chat.deepseek.com](https://chat.deepseek.com), click the extension icon to open the side panel, and add your DeepSeek API key under settings.

## Usage

| Action | How |
| --- | --- |
| Open the manager | Click the extension toolbar icon |
| Search memories in chat | Type `/mem ` followed by a query |
| Insert a memory block | Type `bring mem ...` or use the side panel's **Copy full block** button |
| Auto-capture memories | Enable the timer in side panel settings |

## Project structure

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 extension manifest (permissions, side panel, content scripts) |
| `background.js` | Service worker — handles DeepSeek API calls (memory extraction) |
| `content.js` / `content.css` | Injected into chat.deepseek.com — `/mem` dropdown, auto-capture, toasts |
| `sidepanel.html/css/js` | Memory manager UI (CRUD, import/export, settings) |

## License

MIT
