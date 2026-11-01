# Creates the "01V96 Mixer" shortcut on the current user's desktop.
$root = Split-Path $PSScriptRoot -Parent
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop '01V96 Mixer.lnk'

$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\start.ps1`""
$s.WorkingDirectory = $root
$s.IconLocation = "$root\app\public\icons\app.ico,0"
$s.Description = 'Abre o 01V96 Web Mixer (inicia o servidor se necessário)'
$s.WindowStyle = 7  # minimized: avoids a console flash
$s.Save()
"Atalho criado: $lnk"
