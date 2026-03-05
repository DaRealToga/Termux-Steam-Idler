# 📖 Setup Tutorial

This guide shows you the best way to set up the idler on Termux to avoid permission issues and make sure your login is remembered.

---

## 🚀 Option 1: The Clean Way (Git Clone)

This is the recommended method. It puts the files directly into Termux's internal storage where everything (including login saving) works perfectly.

1. **Open Termux** and make sure you are in the home folder:
   ```bash
   cd ~
   ```
2. **Install Git and Node.js** (if you haven't):
   ```bash
   pkg update && pkg upgrade -y
   pkg install git nodejs -y
   ```
3. **Clone the repo** directly to your home folder:
   ```bash
   git clone https://github.com/DaRealToga/Termux-Steam-Idler.git
   ```
4. **Enter the folder and install**:
   ```bash
   cd Termux-Steam-Idler
   npm install
   ```
5. **Set up your .env**:
   ```bash
   cp .env.example .env
   nano .env
   ```
   (Type your username/password, press `Ctrl+O` then `Enter` to save, `Ctrl+X` to exit).

---

## 📂 Option 2: Moving from Downloads to Home

If you already downloaded the code or folder to your phone's Downloads folder (Using Chrome or an App) and want to move it to the "Root" (Home) of Termux:

1. **Give Termux storage access** (Grant the permission popup):
   ```bash
   termux-setup-storage
   ```
2. **Move the folder** from your Downloads to your Termux Home:
   ```bash
   # Replace 'Termux-Steam-Idler' if your folder has a different name
   cp -r ~/storage/downloads/Termux-Steam-Idler ~/Termux-Steam-Idler
   ```
3. **Go to the new location**:
   ```bash
   cd ~/Termux-Steam-Idler
   ```
4. **Install and run**:
   ```bash
   npm install
   node index.js
   ```

---

## ❓ Why move to Home?

Android's **shared storage** (the folders you see in your Gallery or File Manager) has security restrictions. It:
- ❌ Doesn't allow "Symlinks" (breaks `npm install`)
- ❌ Often blocks Termux from creating new files (breaks `sentry.key` login saving)

The **Termux Home** (`~/`) is private to the app and has full permissions, making the idler much more stable.
