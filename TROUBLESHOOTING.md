# Troubleshooting

Common issues and how to fix them.

---

## Installation

**`EACCES: permission denied, symlink` during `npm install`**

Android's shared storage (`/sdcard/`) doesn't support symlinks, which npm needs. Fix it by adding `--no-bin-links`:

```bash
npm install --no-bin-links
```

Or move the project to Termux's home directory where symlinks work fine:
```bash
cp -r /storage/emulated/0/Download/Termux-Steam-Idler ~/Termux-Steam-Idler
cd ~/Termux-Steam-Idler
npm install
```

**`Cannot find module 'dotenv'` (or any module)**

You need to install dependencies before running:
```bash
npm install
```

**Can't find `.env.example` or other dotfiles**

Files starting with `.` are hidden by default on Android. Just create `.env` directly:
```bash
nano .env
```
Type your Steam username and password, save with `Ctrl+O` → Enter → `Ctrl+X`.

---

## Login Issues

**Always asking for username, password, and Steam Guard on every restart**

This usually means the login key file (`sentry.key`) isn't being saved properly. Check the console output after login:

- If you see `✓ Login key saved to: /path/to/sentry.key` — it's working, the key will be used next time.
- If you see `✗ Failed to save login key` — the storage location doesn't allow writes.

The most common cause is running from shared storage (`/sdcard/`). Android restricts what Termux can write there. Move the project to Termux's home directory:

```bash
cp -r ~/storage/shared/Termux-Steam-Idler ~/Termux-Steam-Idler
cd ~/Termux-Steam-Idler
npm install
node index.js
```

Also make sure your `.env` file exists and has your credentials:
```
STEAM_USERNAME=your_username
STEAM_PASSWORD=your_password
```

**`Login key expired or invalid, clearing it...`**

This is normal. Login keys can expire when you:
- Change your Steam password
- Revoke Steam Guard authorizations
- Haven't used the tool in a while

Just enter your Steam Guard code again and a fresh key will be saved.

**Steam Guard code not being accepted**

Make sure you're entering the code quickly — they expire after about 30 seconds. If using the mobile authenticator, use the code that's currently showing (not the one from the notification).

---

## Runtime Issues

**Game library shows 0 games or fewer than expected**

- Your Steam profile game details need to be set to **Public** (at least temporarily while fetching)
- DLCs and Family Sharing (borrowed) games are filtered out by design
- Free-to-play games only show up if you've played them at least once

**`Web session not available, skipping card drop check`**

This means the web login step failed. Card drop info won't be available, but hour idling still works. This can happen if Steam's servers are under load — try restarting.

**Notification not showing on Android**

You need both:
1. The **Termux:API** app installed from [F-Droid](https://f-droid.org/en/packages/com.termux.api/)
2. The `termux-api` package: `pkg install termux-api`

Both are required — the package alone won't work without the app.

**Saved game selection shows null or broken data**

Delete the old config and start fresh:
```bash
rm config.json
node index.js
```

This was a bug in older versions where unlimited hours were saved as `null` instead of `"unlimited"`. It's fixed in v1.7.0+.

---

## Performance

**Termux keeps killing the process when I close the app**

Use tmux or a wake lock:
```bash
# tmux (recommended)
pkg install tmux -y
tmux new -s steam
node index.js
# Ctrl+B then D to detach

# Or wake lock
termux-wake-lock
```

**High battery drain**

The tool itself uses very little resources. If you're seeing drain, it's likely from Termux staying awake via `termux-wake-lock`. Consider using tmux without the wake lock — it's often enough if your phone doesn't aggressively kill background apps.

---

Still stuck? [Open an issue](https://github.com/DaRealToga/Termux-Steam-Idler/issues) with your error output.
