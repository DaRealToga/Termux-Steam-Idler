require('dotenv').config();
const SteamUser = require('steam-user');
const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { exec } = require('child_process');
const https = require('https');

// ─── Config ──────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, 'config.json');
const LOGINKEY_PATH = path.join(__dirname, 'sentry.key');
const MAX_GAMES = 32;

// ─── State ───────────────────────────────────────────────────────────────────
let client = new SteamUser({ enablePicsCache: true });
let ownedApps = [];
let allGames = [];    // full queue of selected games
let activeGames = []; // currently idling batch (max 32)
let idlingStartTime = null;
let reconnectDelay = 5000;
let manualStop = false;
let isLoggedIn = false;
let webCookies = null;
let cardDrops = {}; // { appid: dropsRemaining }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) {
  const time = new Date().toLocaleTimeString();
  console.log(chalk.gray(`[${time}]`) + ' ' + msg);
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      // Restore Infinity from "unlimited" or null
      return data.map(g => ({
        ...g,
        targetHours: (g.targetHours === 'unlimited' || g.targetHours === null) ? Infinity : g.targetHours,
      }));
    }
  } catch (e) { /* ignore corrupt config */ }
  return null;
}

function saveConfig(games) {
  // Infinity can't be serialized to JSON, store as "unlimited"
  const serializable = games.map(g => ({
    ...g,
    targetHours: g.targetHours === Infinity ? 'unlimited' : g.targetHours,
  }));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(serializable, null, 2), 'utf8');
}

function loadLoginKey() {
  try {
    if (fs.existsSync(LOGINKEY_PATH)) {
      const data = JSON.parse(fs.readFileSync(LOGINKEY_PATH, 'utf8'));
      // Support both old loginKey and new refreshToken format
      return {
        username: data.username,
        refreshToken: data.refreshToken || data.loginKey || null,
      };
    }
  } catch (e) { /* ignore */ }
  return null;
}

function saveLoginKey(username, refreshToken) {
  try {
    fs.writeFileSync(LOGINKEY_PATH, JSON.stringify({ username, refreshToken }, null, 2), 'utf8');
    log(chalk.green('✓ Login token saved to: ') + chalk.gray(LOGINKEY_PATH));
    log(chalk.gray('  (Steam Guard won\'t be needed next time)'));
  } catch (err) {
    log(chalk.red('✗ Failed to save login token: ' + err.message));
    log(chalk.yellow('  You may need to run from Termux home (~/) instead of shared storage'));
  }
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}

// ─── Login ───────────────────────────────────────────────────────────────────

async function promptCredentials() {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'username',
      message: chalk.cyan('Steam Username:'),
      default: process.env.STEAM_USERNAME || undefined,
      validate: v => v.length > 0 || 'Username is required',
    },
    {
      type: 'password',
      name: 'password',
      message: chalk.cyan('Steam Password:'),
      default: process.env.STEAM_PASSWORD || undefined,
      mask: '*',
      validate: v => v.length > 0 || 'Password is required',
    },
  ]);
  return answers;
}

async function promptSteamGuard(domain) {
  const { code } = await inquirer.prompt([
    {
      type: 'input',
      name: 'code',
      message: domain
        ? chalk.yellow(`Steam Guard code sent to ${domain}:`)
        : chalk.yellow('Steam Guard mobile authenticator code:'),
      validate: v => v.length > 0 || 'Code is required',
    },
  ]);
  return code;
}

function doLogin(credentials) {
  return new Promise((resolve, reject) => {
    // One-time listeners for this login attempt
    const onLoggedOn = () => {
      // If PICS cache is enabled, we should wait until it's ready
      if (client.options.enablePicsCache && !client.picsCache.apps) {
        log(chalk.yellow('Waiting for Steam PICS cache (handles Family Sharing filtering)...'));
        client.once('appOwnershipCached', () => {
          cleanup();
          resolve();
        });
      } else {
        cleanup();
        resolve();
      }
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      client.removeListener('loggedOn', onLoggedOn);
      client.removeListener('error', onError);
    };

    client.on('loggedOn', onLoggedOn);
    client.on('error', onError);

    // Build login options
    const loginOpts = {
      accountName: credentials.username,
      rememberPassword: true,
    };

    // Use refresh token if available, otherwise password
    if (credentials.refreshToken) {
      loginOpts.refreshToken = credentials.refreshToken;
    } else {
      loginOpts.password = credentials.password;
    }

    client.logOn(loginOpts);
  });
}

function setupLoginKeyListener(credentials) {
  client.on('refreshToken', (token) => {
    saveLoginKey(credentials.username, token);
    credentials.refreshToken = token;
  });
}

async function login() {
  console.log('');
  console.log(chalk.bold.hex('#1b9feb')('╔══════════════════════════════════════╗'));
  console.log(chalk.bold.hex('#1b9feb')('║') + chalk.bold.white('    🎮  Steam IDler — Login          ') + chalk.bold.hex('#1b9feb')('║'));
  console.log(chalk.bold.hex('#1b9feb')('╚══════════════════════════════════════╝'));
  console.log('');

  const creds = await promptCredentials();

  // Set up the Steam Guard handler BEFORE logging in
  client.on('steamGuard', async (domain, callback) => {
    const code = await promptSteamGuard(domain);
    callback(code);
  });

  log(chalk.yellow('Connecting to Steam...'));

  try {
    await doLogin(creds);
    isLoggedIn = true;
    reconnectDelay = 5000; // reset backoff
    log(chalk.green('✓ Logged in as ') + chalk.bold.white(client.steamID.getSteamID64()));
  } catch (err) {
    log(chalk.red('✗ Login failed: ') + err.message);
    process.exit(1);
  }
}

// ─── Web Session & Badges ────────────────────────────────────────────────────

function fetchUrl(url, cookies) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: cookies ? { Cookie: cookies.join('; ') } : {},
    };

    https.get(options, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, cookies).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function getWebSession() {
  return new Promise((resolve) => {
    client.on('webSession', (sessionID, cookies) => {
      webCookies = cookies;
      resolve(cookies);
    });
    client.webLogOn();
  });
}

async function fetchBadges() {
  if (!webCookies) {
    log(chalk.yellow('Web session not available, skipping card drop check'));
    return {};
  }

  log(chalk.yellow('Checking remaining card drops...'));

  const drops = {};
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    try {
      const html = await fetchUrl(`https://steamcommunity.com/my/badges/?p=${page}`, webCookies);

      // Extract badge rows with card drops remaining
      const badgeRegex = /\/gamecards\/(\d+)\/[\s\S]*?progress_info_bold[^>]*>(\d+)\s*card\s*drop/gi;
      let match;

      while ((match = badgeRegex.exec(html)) !== null) {
        const appid = parseInt(match[1]);
        const remaining = parseInt(match[2]);
        if (remaining > 0) {
          drops[appid] = remaining;
        }
      }

      // Check if there's a next page
      hasMore = html.includes(`?p=${page + 1}`);
      page++;

      // Safety limit
      if (page > 20) break;
    } catch (err) {
      log(chalk.red('Error fetching badges page: ' + err.message));
      break;
    }
  }

  const totalDrops = Object.values(drops).reduce((a, b) => a + b, 0);
  log(chalk.green(`✓ Found ${chalk.bold(Object.keys(drops).length)} games with ${chalk.bold(totalDrops)} card drops remaining`));

  return drops;
}

// ─── DLC Filter ──────────────────────────────────────────────────────────────

async function filterDLCs(apps) {
  log(chalk.yellow('Filtering out DLCs...'));

  const batchSize = 50;
  const gameApps = [];

  for (let i = 0; i < apps.length; i += batchSize) {
    const batch = apps.slice(i, i + batchSize);
    const batchIds = batch.map(a => a.appid);

    try {
      const result = await client.getProductInfo(batchIds, []);

      for (const app of batch) {
        const info = result.apps && result.apps[app.appid];
        if (info && info.appinfo && info.appinfo.common) {
          const type = (info.appinfo.common.type || '').toLowerCase();
          if (type !== 'dlc') {
            gameApps.push(app);
          }
        } else {
          // Can't determine type, include it
          gameApps.push(app);
        }
      }
    } catch (err) {
      // If batch fails, include all from batch
      gameApps.push(...batch);
    }
  }

  const filtered = apps.length - gameApps.length;
  if (filtered > 0) {
    log(chalk.green(`✓ Filtered out ${chalk.bold(filtered)} DLC(s)`));
  } else {
    log(chalk.green('✓ No DLCs found to filter'));
  }

  return gameApps;
}

// ─── Library ─────────────────────────────────────────────────────────────────

async function fetchLibrary() {
  log(chalk.yellow('Fetching your game library...'));

  try {
    const result = await client.getUserOwnedApps(client.steamID, {
      includePlayedFreeGames: true,
      includeAppInfo: true,
    });

    let apps = (result.apps || [])
      .filter(app => app.appid && app.name)
      .sort((a, b) => a.name.localeCompare(b.name));

    log(chalk.green(`✓ Found ${chalk.bold(apps.length)} apps in your library`));

    // Filter out Family Sharing games (only keep truly owned)
    try {
      const myOwnedIds = new Set(await client.getOwnedApps());
      const beforeCount = apps.length;
      apps = apps.filter(app => myOwnedIds.has(app.appid));
      const sharedFiltered = beforeCount - apps.length;
      if (sharedFiltered > 0) {
        log(chalk.green(`✓ Filtered out ${chalk.bold(sharedFiltered)} Family Sharing game(s)`));
      }
    } catch (err) {
      log(chalk.yellow('⚠ Could not filter Family Sharing games: ' + err.message));
    }

    // Filter out DLCs
    apps = await filterDLCs(apps);
    ownedApps = apps;

    log(chalk.green(`✓ ${chalk.bold(ownedApps.length)} games available (DLCs & shared excluded)`));
  } catch (err) {
    log(chalk.red('✗ Could not fetch library: ') + err.message);
    log(chalk.yellow('Make sure your Steam profile game details are public, or try again.'));
    return;
  }
}

// ─── Game Selection ──────────────────────────────────────────────────────────

async function selectGames() {
  if (ownedApps.length === 0) {
    log(chalk.red('No games found in library. Cannot select games.'));
    return [];
  }

  console.log('');
  console.log(chalk.bold.hex('#1b9feb')('─── Select Games to Idle ───'));
  console.log(chalk.gray(`Steam idles up to ${MAX_GAMES} at a time — extras queue and rotate in automatically.`));
  console.log('');

  // Search filter — type to narrow down, or leave blank for all
  const { search } = await inquirer.prompt([
    {
      type: 'input',
      name: 'search',
      message: chalk.cyan('Search games (leave blank to show all):'),
    },
  ]);

  let filteredApps = ownedApps;
  if (search.trim()) {
    const term = search.trim().toLowerCase();
    filteredApps = ownedApps.filter(app => app.name.toLowerCase().includes(term));
    if (filteredApps.length === 0) {
      log(chalk.yellow(`No games matching "${search.trim()}". Showing all games instead.`));
      filteredApps = ownedApps;
    } else {
      log(chalk.green(`Found ${filteredApps.length} games matching "${search.trim()}"`));
    }
  }

  console.log(chalk.gray('Use arrow keys, space to select, enter to confirm.'));

  const { selectedApps } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedApps',
      message: chalk.cyan('Choose games:'),
      choices: filteredApps.map(app => {
        const drops = cardDrops[app.appid];
        const dropTag = drops
          ? chalk.green(` 🃏 ${drops} card drop${drops > 1 ? 's' : ''}`)
          : '';
        return {
          name: `${app.name} ${chalk.gray(`(${app.appid})`)}${dropTag}`,
          value: app,
          short: app.name,
        };
      }),
      pageSize: 20,
      validate: (answer) => {
        if (answer.length === 0) return 'You must select at least one game.';
        return true;
      },
    },
  ]);

  // For each selected game, ask what to do
  const configuredGames = [];
  for (const app of selectedApps) {
    console.log('');
    console.log(chalk.bold.white(`▸ ${app.name}`) + chalk.gray(` (${app.appid})`));

    const drops = cardDrops[app.appid];
    const cardLabel = drops
      ? `🃏  Farm Trading Cards (${drops} drop${drops > 1 ? 's' : ''} remaining)`
      : '🃏  Farm Trading Cards (no drops remaining ⚠️)';

    const { mode } = await inquirer.prompt([
      {
        type: 'list',
        name: 'mode',
        message: chalk.cyan(`What do you want to do with ${chalk.bold(app.name)}?`),
        choices: [
          { name: '⏱️   Idle Hours', value: 'hours' },
          { name: cardLabel, value: 'cards' },
        ],
      },
    ]);

    // Warn if no card drops remain
    if (mode === 'cards' && !drops) {
      log(chalk.yellow(`⚠ ${app.name} has no card drops remaining. It will still idle but won't earn cards.`));
    }

    let targetHours = Infinity;
    if (mode === 'hours') {
      const { hoursChoice } = await inquirer.prompt([
        {
          type: 'list',
          name: 'hoursChoice',
          message: chalk.cyan('How many hours?'),
          choices: [
            { name: '♾️   Unlimited (run forever)', value: 'unlimited' },
            { name: '🔢  Set a specific number of hours', value: 'specific' },
          ],
        },
      ]);

      if (hoursChoice === 'specific') {
        const { hours } = await inquirer.prompt([
          {
            type: 'input',
            name: 'hours',
            message: chalk.cyan('Enter number of hours to idle:'),
            validate: v => {
              const n = parseFloat(v);
              return (n > 0 && !isNaN(n)) || 'Please enter a valid number greater than 0';
            },
          },
        ]);
        targetHours = parseFloat(hours);
      }
    }

    configuredGames.push({
      appid: app.appid,
      name: app.name,
      mode,
      targetHours,
      hoursIdled: 0,
    });
  }

  return configuredGames;
}

// ─── Idling ──────────────────────────────────────────────────────────────────

function startIdling(games) {
  allGames = games;
  activeGames = games.slice(0, MAX_GAMES);
  const queued = games.slice(MAX_GAMES);
  idlingStartTime = Date.now();

  const appIds = activeGames.map(g => g.appid);
  client.gamesPlayed(appIds);

  console.log('');
  console.log(chalk.bold.hex('#1b9feb')('╔══════════════════════════════════════╗'));
  console.log(chalk.bold.hex('#1b9feb')('║') + chalk.bold.white('    🚀  Idling Started!               ') + chalk.bold.hex('#1b9feb')('║'));
  console.log(chalk.bold.hex('#1b9feb')('╚══════════════════════════════════════╝'));
  console.log('');

  for (const game of activeGames) {
    const modeTag = game.mode === 'cards'
      ? chalk.magenta('[CARDS]')
      : chalk.blue('[HOURS]');
    const hoursTag = game.mode === 'hours' && game.targetHours !== Infinity
      ? chalk.gray(` → ${game.targetHours}h target`)
      : game.mode === 'hours'
        ? chalk.gray(' → unlimited')
        : '';
    log(`  ${modeTag} ${chalk.white(game.name)}${hoursTag}`);
  }

  if (queued.length > 0) {
    console.log('');
    log(chalk.yellow(`📋 ${queued.length} game(s) queued — they'll rotate in when active slots free up:`));
    for (const game of queued) {
      log(chalk.gray(`   ⏳ ${game.name}`));
    }
  }

  console.log('');
  log(chalk.gray('Press ') + chalk.bold.white('r + Enter') + chalk.gray(' to re-select games'));
  log(chalk.gray('Press ') + chalk.bold.white('q + Enter') + chalk.gray(' to quit'));
  console.log('');

  // Save config
  saveConfig(games);

  // Update notification immediately
  updateNotification();
}

function checkHourTargets() {
  if (!idlingStartTime || activeGames.length === 0) return;

  const elapsedHours = (Date.now() - idlingStartTime) / (1000 * 60 * 60);
  let changed = false;
  const completed = [];

  activeGames = activeGames.filter(game => {
    if (game.mode === 'hours' && game.targetHours !== Infinity) {
      const totalHours = (game.hoursIdled || 0) + elapsedHours;
      if (totalHours >= game.targetHours) {
        log(chalk.green(`✓ ${game.name} reached ${game.targetHours}h target — done!`));
        completed.push(game);
        changed = true;
        return false;
      }
    }
    return true;
  });

  // Also remove completed from the full queue
  if (completed.length > 0) {
    const completedIds = new Set(completed.map(g => g.appid));
    allGames = allGames.filter(g => !completedIds.has(g.appid));
  }

  if (changed) {
    // Rotate queued games into active slots
    const activeIds = new Set(activeGames.map(g => g.appid));
    const queued = allGames.filter(g => !activeIds.has(g.appid));
    const slotsAvailable = MAX_GAMES - activeGames.length;

    if (slotsAvailable > 0 && queued.length > 0) {
      const rotateIn = queued.slice(0, slotsAvailable);
      activeGames.push(...rotateIn);
      for (const game of rotateIn) {
        log(chalk.cyan(`↻ Rotated in: ${game.name}`));
      }
    }

    if (activeGames.length > 0) {
      const appIds = activeGames.map(g => g.appid);
      client.gamesPlayed(appIds);
      saveConfig(allGames);
    } else {
      client.gamesPlayed([]);
      log(chalk.yellow('All games have reached their targets! Press r + Enter to select new games.'));
    }
  }
}

// Re-check badge page and remove card-farming games that have 0 drops left
async function checkCardDrops() {
  if (!webCookies) return;

  const cardGames = activeGames.filter(g => g.mode === 'cards');
  const queuedCardGames = allGames.filter(g => g.mode === 'cards' && !activeGames.includes(g));
  if (cardGames.length === 0 && queuedCardGames.length === 0) return;

  log(chalk.gray('Re-checking card drops...'));

  try {
    const freshDrops = await fetchBadges();
    cardDrops = freshDrops;
    let changed = false;
    const finished = [];

    // Check active games
    activeGames = activeGames.filter(game => {
      if (game.mode === 'cards') {
        const remaining = freshDrops[game.appid] || 0;
        if (remaining === 0) {
          log(chalk.green(`✓ ${game.name} — all card drops collected! Removing.`));
          finished.push(game);
          changed = true;
          return false;
        }
      }
      return true;
    });

    // Remove finished from full queue too
    if (finished.length > 0) {
      const finishedIds = new Set(finished.map(g => g.appid));
      allGames = allGames.filter(g => !finishedIds.has(g.appid));
    }

    // Also remove queued card games with 0 drops
    allGames = allGames.filter(game => {
      if (game.mode === 'cards' && !activeGames.includes(game)) {
        const remaining = freshDrops[game.appid] || 0;
        if (remaining === 0) {
          log(chalk.green(`✓ ${game.name} — no drops left, removed from queue.`));
          changed = true;
          return false;
        }
      }
      return true;
    });

    if (changed) {
      // Rotate queued games into freed slots
      const activeIds = new Set(activeGames.map(g => g.appid));
      const queued = allGames.filter(g => !activeIds.has(g.appid));
      const slotsAvailable = MAX_GAMES - activeGames.length;

      if (slotsAvailable > 0 && queued.length > 0) {
        const rotateIn = queued.slice(0, slotsAvailable);
        activeGames.push(...rotateIn);
        for (const game of rotateIn) {
          log(chalk.cyan(`↻ Rotated in: ${game.name}`));
        }
      }

      if (activeGames.length > 0) {
        client.gamesPlayed(activeGames.map(g => g.appid));
        saveConfig(allGames);
      } else {
        client.gamesPlayed([]);
        log(chalk.yellow('All card games finished and no more queued! Press r to select new games.'));
      }
    }
  } catch (err) {
    log(chalk.gray('Card drop re-check failed: ' + err.message));
  }
}

// ─── Status Display ──────────────────────────────────────────────────────────

function showStatus() {
  if (!idlingStartTime || activeGames.length === 0) return;

  const uptime = formatUptime(Date.now() - idlingStartTime);
  const gameCount = activeGames.length;

  log(
    chalk.hex('#1b9feb')('⏱ ') +
    chalk.white(`Uptime: ${chalk.bold(uptime)}`) +
    chalk.gray(' │ ') +
    chalk.white(`Games: ${chalk.bold(gameCount)}`) +
    chalk.gray(' │ ') +
    chalk.green('● Connected')
  );
}

// ─── Notification ────────────────────────────────────────────────────────────

function updateNotification() {
  if (!idlingStartTime || activeGames.length === 0) return;

  const elapsedHours = (Date.now() - idlingStartTime) / (1000 * 60 * 60);
  const uptime = formatUptime(Date.now() - idlingStartTime);

  // Build per-game lines
  const lines = activeGames.map(game => {
    const currentHours = ((game.hoursIdled || 0) + elapsedHours).toFixed(1);
    const modeLabel = game.mode === 'cards' ? '🃏 Cards' : '⏱️ Hours';
    const target = game.mode === 'hours' && game.targetHours !== Infinity
      ? ` / ${game.targetHours}h`
      : '';
    return `${game.name}: ${currentHours}h${target} (${modeLabel})`;
  });

  const title = `🎮 Steam IDler — ${activeGames.length} game(s) | ${uptime}`;
  const content = lines.join('\n');

  // Use termux-notification (requires Termux:API app + termux-api package)
  // Using exec (shell) instead of execFile so it searches PATH correctly on Termux
  const escapedTitle = title.replace(/'/g, "'\\''");
  const escapedContent = content.replace(/'/g, "'\\''");
  const cmd = `termux-notification --id steam-idler --title '${escapedTitle}' --content '${escapedContent}' --ongoing --priority low`;

  exec(cmd, (err) => {
    // Silently ignore if termux-notification is not available
    if (err && !notificationWarned) {
      notificationWarned = true;
      log(chalk.yellow('⚠ Notification bar requires Termux:API app + termux-api package'));
      log(chalk.gray('  Install: pkg install termux-api'));
      log(chalk.gray('  Also install "Termux:API" app from F-Droid or Play Store'));
    }
  });
}

function clearNotification() {
  exec('termux-notification-remove steam-idler', () => { });
}

let notificationWarned = false;

// ─── Reconnect ───────────────────────────────────────────────────────────────

function setupAutoReconnect(credentials) {
  client.on('disconnected', (eresult, msg) => {
    if (manualStop) return;
    isLoggedIn = false;
    log(chalk.red(`✗ Disconnected (${msg || eresult}). Reconnecting in ${reconnectDelay / 1000}s...`));

    setTimeout(async () => {
      if (manualStop) return;
      log(chalk.yellow('Attempting to reconnect...'));

      try {
        // Create a fresh client to avoid state issues
        client = new SteamUser();
        setupAutoReconnect(credentials);

        client.on('steamGuard', async (domain, callback) => {
          const code = await promptSteamGuard(domain);
          callback(code);
        });

        await doLogin(credentials);
        isLoggedIn = true;
        reconnectDelay = 5000; // reset
        log(chalk.green('✓ Reconnected!'));

        // Resume idling
        if (activeGames.length > 0) {
          idlingStartTime = Date.now();
          client.gamesPlayed(activeGames.map(g => g.appid));
          log(chalk.green(`✓ Resumed idling ${activeGames.length} game(s)`));
        }
      } catch (err) {
        log(chalk.red(`✗ Reconnect failed: ${err.message}`));
        reconnectDelay = Math.min(reconnectDelay * 2, 60000); // exponential backoff, cap at 1 min
        log(chalk.yellow(`Next retry in ${reconnectDelay / 1000}s...`));

        // Schedule another attempt
        setTimeout(() => {
          if (!manualStop) {
            client.emit('disconnected', 0, 'Retry after failed reconnect');
          }
        }, reconnectDelay);
      }
    }, reconnectDelay);
  });

  client.on('error', (err) => {
    if (manualStop) return;
    log(chalk.red(`✗ Steam error: ${err.message}`));
    // The disconnected event usually fires after error, which triggers reconnect
  });
}

// ─── Input Handler ───────────────────────────────────────────────────────────

function setupInputHandler(credentials) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line) => {
    const cmd = line.trim().toLowerCase();

    if (cmd === 'r') {
      log(chalk.yellow('Opening game selector...'));
      client.gamesPlayed([]); // stop idling while selecting

      const games = await selectGames();
      if (games.length > 0) {
        startIdling(games);
      } else {
        log(chalk.yellow('No games selected. Previous selection still active.'));
        if (activeGames.length > 0) {
          client.gamesPlayed(activeGames.map(g => g.appid));
        }
      }
    } else if (cmd === 'q') {
      log(chalk.yellow('Stopping idler...'));
      manualStop = true;
      client.gamesPlayed([]);
      client.logOff();
      clearNotification();
      log(chalk.green('Goodbye! 👋'));
      process.exit(0);
    } else if (cmd === 's') {
      showStatus();
    }
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const VERSION = '1.7.2';
  console.clear();
  console.log('');
  console.log(chalk.bold.hex('#1b9feb')('╔══════════════════════════════════════════════════╗'));
  console.log(chalk.bold.hex('#1b9feb')('║') + chalk.bold.white('                                                  ') + chalk.bold.hex('#1b9feb')('║'));
  console.log(chalk.bold.hex('#1b9feb')('║') + chalk.bold.white('     🎮  Steam Card & Hour Farmer  🎮            ') + chalk.bold.hex('#1b9feb')('║'));
  console.log(chalk.bold.hex('#1b9feb')('║') + chalk.gray(`           v${VERSION} — Made for Termux              `) + chalk.bold.hex('#1b9feb')('║'));
  console.log(chalk.bold.hex('#1b9feb')('║') + chalk.bold.white('                                                  ') + chalk.bold.hex('#1b9feb')('║'));
  console.log(chalk.bold.hex('#1b9feb')('╚══════════════════════════════════════════════════╝'));
  console.log('');

  // Step 1: Login
  const creds = {
    username: process.env.STEAM_USERNAME,
    password: process.env.STEAM_PASSWORD,
    refreshToken: null,
  };

  // Try to load saved refresh token (skips Steam Guard)
  const savedLogin = loadLoginKey();
  if (savedLogin && savedLogin.refreshToken) {
    creds.username = savedLogin.username;
    creds.refreshToken = savedLogin.refreshToken;
    log(chalk.green('✓ Found saved login token — skipping Steam Guard'));
  }

  // If credentials not in .env and no refresh token, prompt for them
  if (!creds.username || (!creds.password && !creds.refreshToken)) {
    const prompted = await promptCredentials();
    creds.username = prompted.username;
    creds.password = prompted.password;
  }

  // Set up Steam Guard handler
  client.on('steamGuard', async (domain, callback) => {
    const code = await promptSteamGuard(domain);
    callback(code);
  });

  // Save login key when Steam sends one (for future logins without Steam Guard)
  setupLoginKeyListener(creds);

  log(chalk.yellow('Connecting to Steam...'));

  try {
    await doLogin(creds);
    isLoggedIn = true;
    client.setPersona(SteamUser.EPersonaState.Invisible);
    log(chalk.green('✓ Logged in as ') + chalk.bold.white(client.steamID.getSteamID64()) + chalk.gray(' (Invisible)'));
  } catch (err) {
    // If refresh token failed, clear it and retry with password
    if (creds.refreshToken) {
      log(chalk.yellow('⚠ Login token expired or invalid, clearing it...'));
      try { fs.unlinkSync(LOGINKEY_PATH); } catch (e) { /* ignore */ }
      creds.refreshToken = null;

      // Need fresh credentials if we don't have a password
      if (!creds.password) {
        const prompted = await promptCredentials();
        creds.username = prompted.username;
        creds.password = prompted.password;
      }

      // Retry with password
      try {
        client = new SteamUser({ enablePicsCache: true });
        client.on('steamGuard', async (domain, callback) => {
          const code = await promptSteamGuard(domain);
          callback(code);
        });
        setupLoginKeyListener(creds);

        await doLogin(creds);
        isLoggedIn = true;
        client.setPersona(SteamUser.EPersonaState.Invisible);
        log(chalk.green('✓ Logged in as ') + chalk.bold.white(client.steamID.getSteamID64()) + chalk.gray(' (Invisible)'));
      } catch (retryErr) {
        log(chalk.red('✗ Login failed: ') + retryErr.message);
        process.exit(1);
      }
    } else {
      log(chalk.red('✗ Login failed: ') + err.message);
      process.exit(1);
    }
  }

  // Step 2: Setup auto-reconnect (always on unless manually stopped)
  setupAutoReconnect(creds);

  // Step 3: Get web session for badge checking
  log(chalk.yellow('Getting web session...'));
  try {
    await getWebSession();
    log(chalk.green('✓ Web session ready'));
  } catch (err) {
    log(chalk.yellow('⚠ Could not get web session, card drop info will be unavailable'));
  }

  // Step 4: Fetch library (filters out DLCs)
  await fetchLibrary();

  // Step 5: Check card drops
  cardDrops = await fetchBadges();

  // Step 6: Check for saved config
  const savedConfig = loadConfig();
  let games = [];

  if (savedConfig && savedConfig.length > 0) {
    console.log('');
    log(chalk.yellow('Found saved game selection:'));
    const ownedMap = new Map(ownedApps.map(a => [a.appid, a]));
    for (const g of savedConfig) {
      // Cross-reference with library for fresh names
      const libGame = ownedMap.get(g.appid);
      const displayName = libGame ? libGame.name : (g.name || `Unknown (${g.appid})`);
      const modeTag = g.mode === 'cards' ? chalk.magenta('[CARDS]') : chalk.blue('[HOURS]');
      const hoursTag = g.mode === 'hours' && g.targetHours !== Infinity
        ? chalk.gray(` → ${g.targetHours}h`)
        : g.mode === 'hours' ? chalk.gray(' → unlimited') : '';
      console.log(`   ${modeTag} ${chalk.white(displayName)}${hoursTag}`);
    }

    const { useSaved } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'useSaved',
        message: chalk.cyan('Resume with this selection?'),
        default: true,
      },
    ]);

    if (useSaved) {
      const ownedIds = new Set(ownedApps.map(a => a.appid));
      games = savedConfig
        .filter(g => ownedIds.has(g.appid))
        .map(g => {
          // Refresh game names from library
          const libGame = ownedMap.get(g.appid);
          return { ...g, name: libGame ? libGame.name : g.name };
        });
      if (games.length < savedConfig.length) {
        log(chalk.yellow(`${savedConfig.length - games.length} saved game(s) no longer in library, skipped.`));
      }
    }
  }

  if (games.length === 0) {
    // Offer quick-idle-all-cards option
    const gamesWithDrops = Object.keys(cardDrops).length;

    if (gamesWithDrops > 0) {
      console.log('');
      const { quickMode } = await inquirer.prompt([
        {
          type: 'list',
          name: 'quickMode',
          message: chalk.cyan(`Found ${gamesWithDrops} games with card drops. What do you want to do?`),
          choices: [
            { name: `🃏  Idle all ${gamesWithDrops} games with card drops (auto)`, value: 'all_cards' },
            { name: '🎮  Pick games manually', value: 'manual' },
          ],
        },
      ]);

      if (quickMode === 'all_cards') {
        games = Object.entries(cardDrops).map(([appid, drops]) => {
          const id = parseInt(appid);
          const libGame = ownedApps.find(a => a.appid === id);
          return {
            appid: id,
            name: libGame ? libGame.name : `App ${appid}`,
            mode: 'cards',
            targetHours: Infinity,
            hoursIdled: 0,
          };
        });
        log(chalk.green(`✓ Auto-selected ${games.length} games for card farming`));
      }
    }

    if (games.length === 0) {
      games = await selectGames();
    }
  }

  if (games.length === 0) {
    log(chalk.red('No games selected. Exiting.'));
    process.exit(0);
  }

  // Step 5: Start idling
  startIdling(games);

  // Step 6: Setup keyboard input
  setupInputHandler(creds);

  // Step 7: Periodic status + hour target checks (every 5 min)
  setInterval(() => {
    if (isLoggedIn && activeGames.length > 0) {
      showStatus();
      checkHourTargets();
      updateNotification();
    }
  }, 5 * 60 * 1000);

  // Step 8: Re-check card drops every 30 min and auto-remove finished games
  setInterval(() => {
    if (isLoggedIn && activeGames.some(g => g.mode === 'cards')) {
      checkCardDrops();
    }
  }, 30 * 60 * 1000);
}

// ─── Run ─────────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error(chalk.red('Fatal error:'), err);
  process.exit(1);
});
