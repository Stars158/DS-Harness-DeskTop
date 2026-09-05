# =====================================================================
# dsh-desktop  setup / one-click installer   (Windows, PowerShell 5.1+)
#
# Responsibilities:
#   1) Make sure Node + @deepseek-ai/dsh are reachable (auto-detect), else
#      print the exact install steps and stop.
#   2) Provision an Electron runtime under  .\runtime\  (auto reuse if an
#      electron-v*/ electron.exe already exists; otherwise download v33.4.11
#      from GitHub or the npmmirror mirror — big first-time download).
#   3) Create a Desktop + Start-Menu shortcut that launches
#      <repo>\runtime\electron\electron.exe  <repo>\main.cjs
#      with the poster icon in .\assets\.
#   4) (optional) register auto-start at logon.
#
# Re-run at any time; it is idempotent (skips what is already present).
# =====================================================================
param(
    [switch]$NoShortcut,     # do not create shortcuts
    [switch]$AutoStart,      # register logon auto-start too
    [string]$InstallDir = "" # custom install dir (defaults to this script's folder)
)

$ErrorActionPreference = 'Stop'

# ---- paths ----
if (-not $InstallDir) { $InstallDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
$assets   = Join-Path $InstallDir 'assets'
$runtimeDir = Join-Path $InstallDir 'runtime'
$electronVer = '33.4.11'
$electronDir = Join-Path $runtimeDir "electron-v$electronVer"
$electronExe = Join-Path $electronDir 'electron.exe'
$mainJs    = Join-Path $InstallDir 'main.cjs'
$icon  = Join-Path $assets 'bili-icon.ico'
$png   = Join-Path $assets 'icon.png'
$isWin = $env:OS -like 'Windows*'

function Say($m){ Write-Host $m }

Say "== dsh-desktop setup =="
if (-not (Test-Path -LiteralPath $mainJs)) { Say "[FAIL] main.cjs not found at $InstallDir"; exit 1 }
if ($isWin) {
    if (-not (Test-Path -LiteralPath $icon)) { Say "[FAIL] icon missing: $icon"; exit 1 }
    $icoForLnk = $icon
} else {
    $icoForLnk = $png
}

# ---- 1) node + dsh ----
$node=''; try { $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source } catch {}
$whereExe = if ($isWin) { 'where' } else { 'which' }
if (-not $node) { try { $node = (& $whereExe node 2>$null | Select-Object -First 1) } catch {} }
if (-not $node) {
    Say "[WARN] Node.js not found on PATH."
    Say "  1) Install Node LTS from https://nodejs.org  (comes with npm)."
    Say "  2) Reopen a terminal, then run this setup again."
    # Still allow continuing if they already have node later; stop here.
    exit 1
}
Say "- node : $node"

# find @deepseek-ai/dsh bin.js — check the known npm-global locations and PATH
$dshBin = $null
if (Test-Path -LiteralPath (Join-Path $env:APPDATA 'npm\node_modules\@deepseek-ai\dsh\lib\bin.js')) {
    $dshBin = Join-Path $env:APPDATA 'npm\node_modules\@deepseek-ai\dsh\lib\bin.js'
}
if (-not $dshBin) {
    $cand2 = Join-Path $HOME 'AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\lib\bin.js'
    if (Test-Path -LiteralPath $cand2) { $dshBin = $cand2 }
}
if (-not $dshBin) {
    # npm global root fallback via npm.cmd directly
    try {
        $rr = & npm.cmd root -g 2>$null
        if ($rr) { $cand = Join-Path (($rr -join ' ').Trim()) '@deepseek-ai\dsh\lib\bin.js'; if (Test-Path -LiteralPath $cand) { $dshBin = $cand } }
    } catch {}
}
if (-not $dshBin -and (Get-Command dsh.cmd -ErrorAction SilentlyContinue)) {
    $whereDsh = (Get-Command dsh.cmd).Source
    if ($whereDsh) { $cand = Join-Path (Split-Path $whereDsh) 'node_modules\@deepseek-ai\dsh\lib\bin.js'; if (Test-Path -LiteralPath $cand) { $dshBin=$cand } }
}
if (-not $dshBin) {
    Say "[WARN] @deepseek-ai/dsh not found installed globally."
    Say "  Run:  npm i -g @deepseek-ai/dsh"
    exit 1
}
Say "- dsh  : $dshBin"

# ---- 2) electron runtime ----
if (-not (Test-Path -LiteralPath $electronExe)) {
    Say "- provisioning Electron v$electronVer (first run downloads ~100-270 MB)..."
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    $tmp = Join-Path $runtimeDir "electron-$electronVer.zip"
    $urls = @(
        "https://npmmirror.com/mirrors/electron/$electronVer/electron-v$electronVer-win32-x64.zip",
        "https://github.com/electron/electron/releases/download/v$electronVer/electron-v$electronVer-win32-x64.zip"
    )
    $okDesc=''
    foreach ($u in $urls) {
        Say "   downloading $u"
        try { Invoke-WebRequest -Uri $u -OutFile $tmp -UseBasicParsing -ErrorAction Stop; $okDesc=$u; break } catch { Say "   failed: $($_.Exception.Message)" }
    }
    if (-not $okDesc) { Say '[FAIL] could not download Electron. Check network/proxy.'; exit 1 }
    Say "- extracting..."
    try {
        Expand-Archive -LiteralPath $tmp -DestinationPath $runtimeDir -Force
    } catch {
        # fallback tar if Expand-Archive blocked
        & tar -xf $tmp -C $runtimeDir
    }
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    # unzip layout: electron-v..-win32-x64\<bin>
    $inner = Join-Path $runtimeDir "electron-v$electronVer-win32-x64\electron.exe"
    if (-not (Test-Path -LiteralPath $electronExe) -and (Test-Path -LiteralPath $inner)) {
        Move-Item (Join-Path $runtimeDir "electron-v$electronVer-win32-x64") $electronDir -Force
    }
}
if (-not (Test-Path -LiteralPath $electronExe)) { Say "[FAIL] Electron binary missing after install: $electronExe"; exit 1 }
Say "- electron : $electronExe"

# ---- 3) shortcuts ----
if (-not $NoShortcut -and $isWin) {
    $ws = New-Object -ComObject WScript.Shell
    $targets = @(
        (Join-Path ([Environment]::GetFolderPath('Desktop')) 'DSH Desktop.lnk'),
        (Join-Path ([Environment]::GetFolderPath('Programs')) 'dsh-desktop\DSH Desktop.lnk')
    )
    foreach ($t in $targets) {
        $dir = Split-Path -Parent $t; if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        $s = $ws.CreateShortcut($t)
        $s.TargetPath = $electronExe
        $s.Arguments  = '"{0}"' -f $mainJs
        $s.WorkingDirectory = $InstallDir
        $s.IconLocation = $icoForLnk # if png path not supported on fine systems, fallback below
        $s.Description = 'DSH Desktop - open local DeepSeek Harness in its own window'
        $s.Save()
        Say "- shortcut : $t"
    }
}

# ---- 4) autostart ----
if ($AutoStart -and $isWin) {
    $st = Join-Path ([Environment]::GetFolderPath('Startup')) 'DSH Desktop.lnk'
    $ws = New-Object -ComObject WScript.Shell
    $s = $ws.CreateShortcut($st)
    $s.TargetPath = $electronExe
    $s.Arguments  = '"{0}"' -f $mainJs
    $s.WorkingDirectory = $InstallDir
    $s.Save()
    Say "- autostart registered"
}

Say ""
Say "== done =="
Say ("Double-click  'DSH Desktop'  on your Desktop (or Start Menu) to launch")
Say "Tip: after first launch the client owns :3080 and keeps running in the tray."
