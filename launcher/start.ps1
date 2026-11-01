# Starts the 01V96 Web Mixer server (if it is not already running) and opens
# the mixer in its own app window. Used by the desktop shortcut.
$ErrorActionPreference = 'Stop'
$Port = 8096
$Url = "http://localhost:$Port/"
$AppDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'app'
$LogDir = Join-Path $AppDir 'logs'

Add-Type -AssemblyName System.Windows.Forms

function Show-Error($msg) {
    [System.Windows.Forms.MessageBox]::Show($msg, '01V96 Web Mixer', 'OK', 'Error') | Out-Null
}

function Test-Server {
    try {
        $r = Invoke-RestMethod -Uri "$($Url)health" -TimeoutSec 1
        return $r.app -eq '01v96-web-mixer'
    } catch { return $false }
}

if (-not (Test-Server)) {
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node -and (Test-Path 'C:\Program Files\nodejs\node.exe')) { $node = 'C:\Program Files\nodejs\node.exe' }
    if (-not $node) { Show-Error 'Node.js não foi encontrado. Instale o Node.js LTS (winget install OpenJS.NodeJS.LTS).'; exit 1 }

    $busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($busy) { Show-Error "A porta $Port está ocupada por outro programa (PID $($busy[0].OwningProcess))."; exit 1 }

    New-Item -ItemType Directory -Force $LogDir | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $AppDir -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $LogDir "server-$stamp.log") -RedirectStandardError (Join-Path $LogDir "server-$stamp.err.log")

    $deadline = (Get-Date).AddSeconds(15)
    while (-not (Test-Server)) {
        if ((Get-Date) -gt $deadline) { Show-Error "O servidor não respondeu em 15 s. Veja os logs em $LogDir."; exit 1 }
        Start-Sleep -Milliseconds 300
    }
    # Keep only the 10 most recent log pairs.
    Get-ChildItem $LogDir -Filter 'server-*.log' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 20 | Remove-Item -Force -ErrorAction SilentlyContinue
}

# Open as a standalone app window (Edge, then Chrome); fall back to the default browser.
$browsers = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$browser = $browsers | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($browser) { Start-Process -FilePath $browser -ArgumentList "--app=$Url" }
else { Start-Process $Url }
