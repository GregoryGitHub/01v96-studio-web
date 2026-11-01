# Stops the 01V96 Web Mixer server started by start.ps1.
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'server\.js"?\s*$' }
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force; "Servidor parado (PID $($p.ProcessId))" }
if (-not $procs) { 'Nenhum servidor rodando.' }
