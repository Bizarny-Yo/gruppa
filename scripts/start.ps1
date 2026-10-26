# Поднять приложение: собрать (если нужно), запустить сервер, проверить, что живо.
# Использование:
#   powershell -ExecutionPolicy Bypass -File scripts\start.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Build

param(
  [int]$Port = 47824,
  [switch]$Build
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Find-Node {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $fallback = "C:\Users\v_alb\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
  if (Test-Path $fallback) { return $fallback }

  throw "Node.js не найден. Установи Node 22+ или поправь путь в скрипте."
}

$node = Find-Node
Write-Host "Node: $node" -ForegroundColor DarkGray

# 1. Сборка фронтенда
$needBuild = $Build -or -not (Test-Path (Join-Path $repo "public\index.html"))
if ($needBuild) {
  Write-Host "→ собираю фронтенд" -ForegroundColor Cyan
  & $node (Join-Path $repo "node_modules\vite\bin\vite.js") build | Select-Object -Last 3
}

# 2. Освободить порт, если занят
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($conn) {
  Write-Host "→ порт $Port занят (pid $($conn.OwningProcess)), перезапускаю" -ForegroundColor Yellow
  Stop-Process -Id $conn.OwningProcess -Force
  Start-Sleep -Milliseconds 700
}

# 3. Запуск
Write-Host "→ запускаю сервер" -ForegroundColor Cyan
Start-Process -FilePath $node -ArgumentList "server\index.js" -WorkingDirectory $repo -WindowStyle Hidden

# 4. Проверка
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 400
  try {
    $h = Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 3
    Write-Host ""
    Write-Host "  Сайт поднят" -ForegroundColor Green
    Write-Host "  локально: http://127.0.0.1:$Port"

    $ip = (Get-NetIPAddress -AddressFamily IPv4 |
      Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and $_.IPAddress -notlike "198.18.*" } |
      Select-Object -First 1).IPAddress
    if ($ip) { Write-Host "  в сети:   http://${ip}:$Port" }

    Write-Host ""
    Write-Host "  публичная ссылка — отдельно:" -ForegroundColor DarkGray
    Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\tunnel-serveo.ps1" -ForegroundColor DarkGray
    exit 0
  } catch {
    # сервер ещё поднимается
  }
}

Write-Host "Сервер не ответил. Смотри ошибку вручную:" -ForegroundColor Red
Write-Host "  node server\index.js" -ForegroundColor Red
exit 1
