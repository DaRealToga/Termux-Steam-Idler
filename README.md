# Steam Card & Hour Farmer

A simple Node.js tool that idles your Steam games in the background to farm trading cards and rack up playtime. Built to run 24/7 on **Termux** (Android), but works on any Linux/macOS system too.

![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=node.js)
![Platform](https://img.shields.io/badge/Platform-Termux%20%7C%20Linux-blue)
![Version](https://img.shields.io/badge/Version-1.7.1-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)

## What it does

- Lets you **pick games from your actual library** — no need to manually look up App IDs
- **Search/filter** your library by name if you have hundreds of games
- For each game, you choose: **farm cards** or **idle hours** (with a target or unlimited)
- **One-click card farming** — auto-detects and idles every game with remaining drops
- Shows how many **card drops you have left** per game before you pick
- **Auto-stops card farming** when all drops are collected (re-checks every 30 min)
- **Filters out DLCs and Family Sharing games** automatically so you only see what's yours
- Logs in as **Invisible** — your friends won't see you online
- **Remembers your login** after the first Steam Guard code, so you don't have to re-enter it
- **Saves your game picks** between sessions — just hit "resume" on restart
- **Auto-reconnects** if your internet drops. You don't need to babysit it
- You can pick **more than 32 games** — it queues extras and rotates them in as slots open up
- Optionally shows a **persistent notification** on Android with your idling stats

## Setup (Termux)

> [!TIP]
> **New to Termux?** Check out the [**Step-by-Step Setup Tutorial**](SETUP_TUTORIAL.md) for an easier installation guide.

```bash
# Install Node.js
pkg update && pkg upgrade -y
pkg install nodejs git -y

# Clone and install
git clone https://github.com/DaRealToga/Termux-Steam-Idler.git
cd Termux-Steam-Idler
npm install

# Set up credentials
cp .env.example .env
nano .env
# Put your Steam username and password, then save (Ctrl+O, Ctrl+X)

# Run
node index.js
```

On first launch it'll ask for your Steam Guard code (email or app). After that it saves a login key so you won't need it again.

## Keeping it running 24/7

Termux will kill the process when you close the app unless you do one of these:

**tmux (recommended):**
```bash
pkg install tmux -y
tmux new -s steam
node index.js
# Ctrl+B then D to detach — it keeps running
# Come back later: tmux attach -t steam
```

**Wake lock:**
```bash
termux-wake-lock
node index.js
```

Or use both for maximum reliability.

## Controls

While the idler is running, type these and press Enter:

| Key | What it does |
|-----|-------------|
| `r` | Re-pick your games |
| `s` | Show uptime and status |
| `q` | Quit and log off |

## Notification bar (optional)

If you want a persistent Android notification showing what's being idled:

1. Install the **Termux:API** app from [F-Droid](https://f-droid.org/en/packages/com.termux.api/)
2. Run `pkg install termux-api` in Termux

It updates every 5 minutes with per-game hours and mode info. If you skip this step, everything still works — you just won't get the notification.

## Project files

```
Termux-Steam-Idler/
├── index.js          # The whole app
├── package.json      # Dependencies
├── .env.example      # Credential template
├── .env              # Your credentials (gitignored)
├── config.json       # Your saved game picks (auto-created)
├── sentry.key        # Saved login key (auto-created, gitignored)
└── LICENSE
```

## How it works under the hood

1. Logs into Steam via the `steam-user` library, goes Invisible
2. Pulls your full game library from the Steam API
3. Filters out DLCs (checks each app's type via `getProductInfo`) and Family Sharing games (cross-references your licenses)
4. Scrapes your Steam badges page to find remaining card drops
5. You pick games and modes through an interactive terminal menu
6. Calls `gamesPlayed()` with up to 32 app IDs at a time
7. If you picked more than 32, the rest sit in a queue and rotate in when something finishes
8. If the connection drops, it retries with exponential backoff (5s, 10s, 20s... up to 60s)
9. Everything gets saved to `config.json` so you can resume next time

Having issues? Check the [Troubleshooting Guide](TROUBLESHOOTING.md).

## FAQ

**Does this steal my credentials?**

No. Everything runs locally on your device. Your username and password are sent directly to Steam's servers through the `steam-user` library — the same protocol the official Steam client uses. Nothing is sent anywhere else. The code is fully open source and straightforward to audit.

**Can I get banned for this?**

Steam's ToS don't explicitly endorse idling tools, but in practice, Valve has never banned accounts for it. Tools like ArchiSteamFarm have been around for years with millions of users and zero bans. The hours you accumulate are real — you're "running" the game, just not actively playing. That said, use at your own discretion.

**Does this actually play my games?**

No. It tells Steam you're running the game, but nothing is downloaded or launched. It just sends the right signals so Steam registers playtime. This is why it barely uses any resources.

**Why only 32 games at once?**

That's a hard cap in Steam's protocol — there's no way around it. If you select more than 32, the extras queue up and automatically rotate in when a slot opens.

**How long until I get card drops?**

Steam requires at least 2 hours of playtime before drops start. After that, they come at random intervals. Fewer games idling at once = faster drops per game.

**Does it work on PC or a Linux server?**

Yes. It runs anywhere Node.js is available. Just skip the Termux-specific stuff (wake lock, notifications, etc).

**My library is showing fewer games than I own**

DLCs and Family Sharing (borrowed) games are filtered out by default. Only games tied to your own licenses show up.

**It's asking for Steam Guard again even though I already entered it**

Login keys expire if you change your password, revoke authorizations, or if Steam invalidates the session. Enter the code once more and it'll save a fresh key.

## Good to know

- Steam caps simultaneous idling at **32 games** — extras queue and rotate in
- Fewer games at once = faster card drops per game
- You appear offline to friends (Invisible mode)
- Card farming auto-stops when all drops are collected (re-checked every 30 min)
- Auto-reconnect never gives up unless you press `q`
- Steam Guard is only needed once — a login key is saved after that

## License

MIT
