/*
 * dsh-desktop  clean native client for the LOCAL DeepSeek Harness web.
 *
 * Why this works (verified against dsh web v0.1.2):
 *   `dsh web` authenticates through a one-time token embedded in the URL it
 *   prints at boot:  http://127.0.0.1:3080/?token=<tok> . Opening the bare
 *   origin returns 401 ("reopen the URL printed by dsh web"). So this client
 *   simply spawns the same local `dsh web` the user starts by hand, captures
 *   the printed tokenized URL from its stdout, and navigates its embedded
 *   window to THAT url. Content then renders  no login UI, no cloud account,
 *   no membership upsell. It reuses the user's existing ~/.dsh home/key.
 *
 * Behaviour:
 *   * spawns / takes over the local dsh web backend (port 3080),
 *   * shows the DSH UI in its own native window,
 *   * tray resident; closing the window only hides to tray (background kept),
 *   * single instance; a 2nd launch raises the existing window,
 *   * tray -> Quit ends backend + app.
 *
 * Run with the electron runtime already on disk, e.g.
 *   "...\desktop-shell-runtime\electron-v33.4.11\electron.exe" "main.cjs"
 */
const { spawn, spawnSync } = require('node:child_process')
const { app, BrowserWindow, Tray, Menu, nativeImage, dialog } = require('electron')
const { existsSync } = require('node:fs')
const { join } = require('node:path')
const os = require('node:os')
const process = require('node:process')

const APP_NAME = 'DSH Desktop'
const PORT = 3080
const TARGET_BASE = `http://127.0.0.1:${PORT}`
const TOKEN_RE = /http:\/\/127\.0\.0\.1:\d+\/(?:[^"'\s]*[?)&]token=|=)?([A-Za-z0-9_\-]{8,})/ 

let mainWindow = null
let tray = null
let back = null // spawned backend child (ours)
let booting = false
let tokenUrl = null
let logPath = null

// ---------------------------------------------------------------------------
// backend helpers
// ---------------------------------------------------------------------------
function fmtHome() {
  return app.getPath('home')
}
function dshHome() {
  // Honor an explicit DSH_HOME; default to ~/.dsh (works on any machine).
  if (process.env.DSH_HOME && existsSync(process.env.DSH_HOME)) return process.env.DSH_HOME
  return join(app.getPath('home'), '.dsh')
}
function launcherDir() {
  return join(dshHome(), 'client')
}

// Locate a real `node` and the `@deepseek-ai/dsh` entrypoint to spawn.
// Resolution order:
//   1) explicit env DSH_DESKTOP_NODE / DSH_DESKTOP_DSH (installer sets these),
//   2) npm global root (APPDATA\npm) as-installed,
//   3) `node`/`dsh` on PATH.
function resolveDsh() {
  const npmRoot = process.env.APPDATA ? join(process.env.APPDATA, 'npm') : null
  const homeRoot = join(app.getPath('home'), 'AppData', 'Roaming', 'npm')
  const dshCands = []
  if (process.env.DSH_DESKTOP_DSH) dshCands.push(process.env.DSH_DESKTOP_DSH)
  dshCands.push(
    npmRoot && join(npmRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    join(homeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  )
  const dshMain = dshCands.find((p) => p && existsSync(p)) || ''

  let node = ''
  if (process.env.DSH_DESKTOP_NODE) node = process.env.DSH_DESKTOP_NODE
  if (!existsSync(node)) {
    try { node = spawnSync('where', ['node']).stdout.toString().trim().split(/\r?\n/)[0] } catch {}
  }
  if (!existsSync(node)) {
    const cand = [npmRoot && join(npmRoot, 'node.exe'), join(homeRoot, 'node.exe'),
      'C:\\Program Files\\nodejs\\node.exe',
      join(process.env.LOCALAPPDATA || '', 'Programs\\nodejs\\node.exe'), 'D:\\nodejs\\node.exe'].filter(Boolean)
    node = cand.find((p) => existsSync(p)) || ''
  }
  return { node, dshMain }
}

function log(line) {
  try {
    const { writeFileSync, mkdirSync } = require('node:fs')
    const d = launcherDir()
    mkdirSync(d, { recursive: true })
    logPath = logPath || join(d, 'dsh-desktop.log')
    writeFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`, { flag: 'a' })
  } catch {}
}

function portOwner(port) {
  // returns {pid,name,cmd} for the LISTENER on localhost:port (Windows netstat)
  const out = spawnSync('netstat', ['-ano']).stdout.toString()
  const re = new RegExp(`TCP\\s+[^\\s]*:${port}\\s+[^\\s]+\\s+LISTENING\\s+(\\d+)`)
  const m = out.match(re)
  return m ? Number(m[1]) : null
}

function killPidTree(pid) {
  try { spawnSync('taskkill', ['/PID', String(pid), '/F', '/T']) } catch {}
}

// Stop any OTHER dsh web holding :3080 (only genuine node dsh). Keep ours.
function cimOf(childPid) {
  // Return {name, commandLine} for a process via PowerShell CIM. Uses full
  // powershell path + EncodedCommand so quoting/paths can never break it.
  const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  const src =
    "Get-CimInstance Win32_Process -Filter 'ProcessId=" + childPid +
    "' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name + '|' + $_.CommandLine }"
  const enc = Buffer.from(src, 'utf16le').toString('base64')
  const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc])
  if (r.status !== 0) return null
  const line = String(r.stdout || '').trim()
  if (!line) return null
  const i = line.indexOf('|')
  if (i < 0) return null
  return { name: line.slice(0, i).trim(), commandLine: line.slice(i + 1) }
}

function isDshWeb(info) {
  if (!info) return false
  return /node\.exe/i.test(info.name || '') && /\.js/.test(info.commandLine || '') && /(^|[\s\W])web([\s\W]|$)/i.test(info.commandLine || '')
}

function stopForeignDshWeb() {
  let pid = portOwner(PORT)
  if (!pid) return
  if (back && pid === back.pid) return // ours, leave it
  const info = cimOf(pid)
  if (!isDshWeb(info)) {
    log(`stopForeign: holder pid=${pid} is not a node dsh web, leaving it`)
    return
  }
  log(`stopping foreign dsh web pid=${pid}`)
  killPidTree(pid)
  // Wait until the port is actually free (taskkill tree takes a moment).
  for (let i = 0; i < 40; i++) {
    if (!portOwner(PORT)) return
    try { spawnSync('ping', ['-n', '1', '-w', '300', '127.0.0.1', '>NUL']) } catch {}
  }
}

// ---- state helpers: remember an already-running instance of OURS ------
function statePath() { return join(launcherDir(), 'state.json') }

function readState() {
  try { return JSON.parse(require('node:fs').readFileSync(statePath(), 'utf8')) } catch { return null }
}
function writeState(s) {
  try {
    require('node:fs').mkdirSync(launcherDir(), { recursive: true })
    require('node:fs').writeFileSync(statePath(), JSON.stringify(s))
  } catch {}
}
function pidAlive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

// ---- spawn our own backend and capture the printed token URL ----
function startBackend() {
  // A no-auto mode (DSH_CLIENT_NOAUTOSTART=1) opens the window and tray
  // WITHOUT taking over the running backend  use it to validate the UI
  // safely before a full takeover run.
  const noAuto = !!(process.env.DSH_CLIENT_NOAUTOSTART === '1')

  // 1) Reuse a backend WE spawned earlier on this machine (same port, state
  //    token) so re-open right after tray is instant and keeps the session.
  const st = readState()
  const holder = portOwner(PORT)
  if (st && st.pid && holder === st.pid && st.tokenUrl && pidAlive(st.pid)) {
    log('reusing our own backend pid=' + st.pid)
    tokenUrl = st.tokenUrl
    back = null
    booting = false
    // verify by navigating; if not reachable we fall back below
    try {
      const { spawnSync } = require('node:child_process')
      const r = spawnSync('powershell', ['-NoProfile','-NonInteractive','-Command',
        `try{(iwr -UseBasicParsing '${st.tokenUrl}').StatusCode}catch{'down'}`])
      if (r.stdout && !/^down\s*$/m.test(String(r.stdout))) {
        loadTarget(tokenUrl); return
      }
    } catch {}
    log('reuse failed/401  will (re)spawn backend')
    back = null
  }

  // 2) In no-auto mode we DO NOT stop the running web nor spawn ours.
  if (noAuto) {
    log('no-auto mode  not taking over backend')
    showOffline()
    return
  }

  stopForeignDshWeb()
  const { node, dshMain } = resolveDsh()
  if (!node || !dshMain || !existsSync(dshMain)) {
    log(`cannot start dsh: node=${node} bin=${dshMain}`)
    showStatus('无法定位 dsh —— 请确认已通过 npm 全局安装 @deepseek-ai/dsh，且本机 ~/.dsh 存在。')
    return
  }
  booting = true
  log(`spawning: ${node} ${dshMain} web`)
  back = spawn(node, [dshMain, 'web', '--no-open'], {
    cwd: dshHome(),
    env: { ...process.env, DSH_HOME: dshHome() },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  back.stderr.on('data', (d) => log('be: ' + String(d)))
  back.on('exit', (code) => {
    log(`backend exited code=${code}`)
    const was = back
    back = null
    if (was) { const s = readState(); if (s && s.pid === was.pid) writeState({}) /* clear stale */ }
    booting = false
    if (app.isQuitting) return
    showOffline()
  })

  let acc = ''
  back.stdout.on('data', (d) => {
    acc += String(d)
    const m = acc.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_\-]+/)
    if (m && !tokenUrl) {
      tokenUrl = m[0]
      writeState({ pid: back.pid, tokenUrl })
      log('captured token URL pid=' + back.pid)
      booting = false
      loadTarget(tokenUrl)
    }
    if (acc.length > 1024 * 1024) { const i = acc.lastIndexOf('http:'); acc = i >= 0 ? acc.slice(i) : '' }
  })

  const t = setInterval(() => {
    if (tokenUrl || app.isQuitting) { clearInterval(t); return }
    if (portOwner(PORT) === back?.pid) showOffline()
  }, 3000)
}

// ---------------------------------------------------------------------------
// window / views
// ---------------------------------------------------------------------------
function loadTarget(url) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.loadURL(url)
}

function showOffline() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(offlineHtml()))
  }
}

function offlineHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{height:100%;margin:0;background:#0f1115;color:#cfd6e6;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center}
      .c{max-width:34rem;padding:2rem;text-align:center} code{background:#1c2129;padding:.2rem .4rem;border-radius:.3rem}
      button{margin-top:1rem;padding:.6rem 1.4rem;background:#4f7cff;color:#fff;border:0;border-radius:.5rem;cursor:pointer}
      </style></head><body><div class="c">
      <h2>正在启动 dsh web 后端…</h2><p>客户端会自行启动并接上本机 dsh web（127.0.0.1:3080），随后在你自己的窗口里显示 DSH 界面。若长时间停留于此：<br>
      请确认已通过 npm 全局安装 <code>@deepseek-ai/dsh</code>，且 <code>~/.dsh</code> 配置正常。</p>
      <button onclick="location.reload()">重试</button></div></body></html>`
}

function showStatus(msg) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          `<!doctype html><meta charset="utf-8"><body style="background:#0f1115;color:#cfd6e6;font-family:system-ui"><h3>DSH Desktop</h3><p>${msg}</p></body>`,
        ),
    )
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 500,
    backgroundColor: '#0f1115',
    title: APP_NAME,
    show: false,
    autoHideMenuBar: true,
    icon: iconPath(),
  })
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('close', (e) => {
    // hide-to-tray unless truly quitting
    if (!app.isQuitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.on('page-title-updated', (ev) => ev.preventDefault())
  return mainWindow
}

function iconPath() {
  // Prefer this repo's own icon (assets/) over a whale ico fallback.
  const cand = [
    join(__dirname, 'assets', 'bili-icon.ico'),
    join(dshHome(), 'profiles', 'web', 'node_modules', 'dsh-clean-desktop-shell', 'build', 'icon.ico'),
  ]
  const f = cand.find(existsSync)
  return f || undefined
}

// ---------------------------------------------------------------------------
// tray you can interact with
// ---------------------------------------------------------------------------
function makeTray() {
  const ico = join(__dirname, 'assets', 'icon.png')
  try {
    let img = nativeImage.createFromPath(existsSync(ico) ? ico : (iconPath() || ''))
    // Tray icons are ~16px; downscale the large poster so it reads crisply.
    if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 })
    tray = new Tray(img)
  } catch {
    // Tray without a file icon may throw; skip creating tray if so.
    log('tray icon unavailable; tray disabled')
    tray = null
  }
  refreshTray()
}

function refreshTray() {
  if (!tray) return
  const st =
    tokenUrl ? '运行中' :
    booting ? '启动中…' :
    '未启动'
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 打开窗口', click: () => { showWindow() } },
    { label: '刷新', click: () => { if (tokenUrl) loadTarget(tokenUrl); else if (mainWindow) mainWindow.reload() } },
    { type: 'separator' },
    { label: `后端：${st}`, enabled: false },
    { type: 'separator' },
    { label: '退出 DSH', click: quitAll }])
  tray.setContextMenu(menu)
}

function quitAll() {
  app.isQuitting = true
  if (back && typeof back.kill === 'function') { try { back.kill() } catch {} }
  app.quit()
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); if (tokenUrl) loadTarget(tokenUrl); else showOffline() }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// ---------------------------------------------------------------------------
// single instance
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.setAppUserModelId ? app.setAppUserModelId('dsh.desktop') : null
  app.on('second-instance', () => showWindow())

  app.whenReady().then(() => {
    createWindow()
    showOffline()          // immediate content while backend spins up
    startBackend()         // spawn/take over dsh web and capture token URL
    makeTray()
    setInterval(refreshTray, 4000) // keep menu/status fresh
    app.on('activate', () => showWindow())
  })

  app.on('window-all-closed', () => {
    // stay resident (tray); do not quit
  })
}
