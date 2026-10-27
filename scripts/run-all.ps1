# Поднимает сервер и туннель, не завися от DSH.
# Запускается либо вручную, либо из автозапуска (scripts/install-autostart.ps1).
#
# Поведение:
#   1. если порт свободен — стартует сервер приложения
#   2. держит SSH-туннель serveo, переподключаясь при обрывах
#
# Остановить: закрыть окно (если запущено вручную) или убить процессы node/ssh.

$ErrorActionPreference = "Continue"

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$port = 47824
$name = "gruppa-605x"

function Find-Node {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $fallback = "C:\Users\v_alb\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
  if (Test-Path $fallback) { return $fallback }
  return $null
}

$node = Find-Node
if (-not $node) {
  Write-Host "Node не найден — сервер не запустить" -ForegroundColor Red
  exit 1
}

# 1. Сервер
$conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($conn) {
  Write-Host "Сервер уже слушает $port (pid $($conn.OwningProcess))" -ForegroundColor DarkGray
} else {
  Write-Host "Запускаю сервер на $port" -ForegroundColor Cyan
  Start-Process -FilePath $node -ArgumentList "server\index.js" -WorkingDirectory $repo -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

# 2. Туннель (бесконечный цикл)
$ssh = "C:\WINDOWS\System32\OpenSSH\ssh.exe"
if (-not (Test-Path $ssh)) {
  $cmd = Get-Command ssh -ErrorAction SilentlyContinue
  if ($cmd) { $ssh = $cmd.Source }
}

if (-not $ssh) {
  Write-Host "OpenSSH не найден — туннель не поднять" -ForegroundColor Red
  exit 1
}

Write-Host "Туннель: https://$name.serveousercontent.com" -ForegroundColor Cyan

while ($true) {
  & $ssh -p 443 -o StrictHostKeyChecking=accept-new -o ExitOnForwardFailure=yes `
    -o ServerAliveInterval=20 -o ServerAliveCountMax=3 `
    -R "${name}:80:127.0.0.1:$port" serveo.net 2>&1 | Out-Null

  Write-Host "Туннель закрылся, переподключаюсь через 5с" -ForegroundColor DarkGray
  Start-Sleep -Seconds 5
}
