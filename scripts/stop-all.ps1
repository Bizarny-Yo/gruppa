# Останавливает сайт: сервер, туннель и всё, что осталось от запуска.
# Вызывается из «Остановить сайт.cmd» или вручную.

$ErrorActionPreference = "SilentlyContinue"

Write-Host "Останавливаю..." -ForegroundColor Cyan

# 1. Туннели
Get-Process ssh -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Наши node-процессы (сервер приложения и старый демо-канбан)
$procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue
foreach ($p in $procs) {
  if ($p.CommandLine -match "server\\index\.js|vibe-demo") {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

# 3. Цикл run-all, если запущен отдельным окном
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match "run-all" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Sleep -Milliseconds 500

$port = Get-NetTCPConnection -LocalPort 47824 -State Listen -ErrorAction SilentlyContinue
if ($port) {
  Write-Host "Внимание: порт 47824 всё ещё занят (pid $($port.OwningProcess))" -ForegroundColor Yellow
} else {
  Write-Host "Сайт остановлен. Порт 47824 свободен." -ForegroundColor Green
}
