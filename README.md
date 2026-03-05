# 🎮 Steam Card & Hour Farmer

A lightweight Node.js CLI tool that idles your Steam games to farm trading cards and accumulate playtime. Designed to run 24/7 on **Termux** (Android).

![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=node.js)
![Platform](https://img.shields.io/badge/Platform-Termux%20%7C%20Linux-blue)
![Version](https://img.shields.io/badge/Version-1.5.0-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)

## ✨ Features

- **🎮 Interactive game selector** — browse your full library and pick games, no hardcoded IDs
- **⏱️ Per-game mode** — choose between card farming or hour idling for each game
- **🔢 Hour targets** — set specific hours to idle or run unlimited
- **📋 Unlimited selection with queue** — select as many games as you want; idles 32 at a time, extras auto-rotate in
- **🃏 Card drop checker** — shows remaining card drops for each game from your Steam badges
- **🚫 DLC filter** — automatically excludes DLCs from the game list
- **👨‍👩‍👦 Family Sharing filter** — only shows games you own, not borrowed ones
- **👻 Invisible mode** — logs in as Invisible so friends don't see you
- **🔁 Auto-reconnect** — reconnects automatically with exponential backoff if disconnected
- **🔑 Login key persistence** — saves auth so Steam Guard is only needed once
- **💾 Persistent config** — saves your game selection across restarts
- **🔔 Android notification** — shows idling status in your notification bar (requires Termux:API)
- **⌨️ Live controls** — re-select games, check status, or quit without restarting

## 📋 Requirements

- [Termux](https://f-droid.org/en/packages/com.termux/) (recommended from F-Droid)
- [Node.js](https://nodejs.org/) 18+
- A Steam account

## 🚀 Quick Start

### Termux Setup

```bash
# 1. Update packages & install Node.js
pkg update && pkg upgrade -y
pkg install nodejs -y

# 2. Clone the repo
pkg install git -y
git clone https://github.com/YOUR_USERNAME/steam-idler.git
cd steam-idler

# 3. Install dependencies
npm install

# 4. Set up your credentials
cp .env.example .env
nano .env
# Fill in your STEAM_USERNAME and STEAM_PASSWORD
# Save: Ctrl+O → Enter | Exit: Ctrl+X

# 5. Run it!
node index.js
```

### First Login

1. The app will connect to Steam and ask for your **Steam Guard code** (email or mobile)
2. Enter the code — this is only needed **once**; a login key is saved for future runs
3. Your game library loads, DLCs and Family Sharing games are filtered out
4. Pick your games, choose a mode for each, and idling starts!

## 🔧 Running 24/7

To keep it running when you close Termux:

### Option A: tmux (recommended)
```bash
pkg install tmux -y
tmux new -s steam
node index.js
# Press Ctrl+B then D to detach
# To reattach later: tmux attach -t steam
```

### Option B: Termux wake lock
```bash
termux-wake-lock
node index.js
```

### Option C: Both (most reliable)
```bash
termux-wake-lock
tmux new -s steam
node index.js
```

## ⌨️ Controls (while idling)

| Key | Action |
|-----|--------|
| `r` + Enter | Re-select games |
| `s` + Enter | Show status (uptime, game count) |
| `q` + Enter | Quit gracefully |

## 🔔 Android Notifications (Optional)

To get a persistent notification showing your idling status:

1. Install the **Termux:API** app from [F-Droid](https://f-droid.org/en/packages/com.termux.api/)
2. In Termux: `pkg install termux-api`

The notification updates every 5 minutes with:
- Total uptime
- Per-game hours idled
- Game mode (Cards / Hours)

## 📁 Project Structure

```
steam-idler/
├── index.js          # Main application
├── package.json      # Dependencies
├── .env.example      # Credential template
├── .env              # Your credentials (git-ignored)
├── config.json       # Saved game selection (auto-generated)
├── sentry.key        # Login key (auto-generated, git-ignored)
├── .gitignore
└── README.md
```

## 📝 How It Works

1. **Logs into Steam** using your credentials, sets status to Invisible
2. **Fetches your game library** via Steam API
3. **Filters out** DLCs (via `getProductInfo`) and Family Sharing games (via license check)
4. **Checks your Steam badges** page for remaining card drops
5. **Interactive selector** lets you pick games and choose Card Farming or Hour Idling
6. **Sends `gamesPlayed`** to Steam — up to 32 games simultaneously
7. **Queues extras** and auto-rotates them in when active games reach their hour targets
8. **Saves everything** to `config.json` — on restart, offers to resume your selection
9. **Auto-reconnects** if disconnected, with exponential backoff (5s → 60s cap)

## 🔧 Troubleshooting

### `EACCES: permission denied, symlink` during `npm install`

This happens when running from Android's shared storage (`/sdcard/` or `/storage/emulated/0/`), which doesn't support symlinks. Fix:

```bash
npm install --no-bin-links
```

Or move the project to Termux's home directory instead:
```bash
cp -r /storage/emulated/0/Download/steam-idler ~/steam-idler
cd ~/steam-idler
npm install
```

### `Cannot find module 'dotenv'` (or any module)

You need to install dependencies first:
```bash
cd ~/steam-idler   # or wherever your project is
npm install
```

### `.env.example` not found / hidden files missing

Files starting with `.` are hidden on some systems. Just create `.env` manually:
```bash
nano .env
```
Then type your credentials and save (`Ctrl+O` → Enter → `Ctrl+X`).

## ⚠️ Notes

- Steam allows idling up to **32 games simultaneously** — extras are queued and rotate in
- Card drops happen faster when idling **fewer games** at once
- Your Steam profile will show "In non-Steam game" or nothing (Invisible mode)
- The tool auto-reconnects unless you press `q` to stop manually
- Steam Guard code is only needed on **first login** — a login key is saved after that

## 📄 License

MIT — free to use, modify, and distribute.
