# Публичный туннель к локальному приложению без аккаунта и без денег.
# Требует: cloudflared (winget install Cloudflare.cloudflared) и ВЫКЛЮЧЕННЫЙ прокси/VPN,
# иначе Cloudflare режет соединение (ошибка "failed to request quick Tunnel: EOF").
#
# Запуск:  powershell -ExecutionPolicy Bypass -File scripts/tunnel.ps1

param([int]$Port = 47824)

$candidates = @(
  "C:\Program Files (x86)\cloudflared\cloudflared.exe",
  "C:\Program Files\cloudflared\cloudflared.exe"
)
$exe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $exe) {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { $exe = $cmd.Source }
}

if (-not $exe) {
  Write-Host "cloudflared не найден. Установи: winget install Cloudflare.cloudflared" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "  Поднимаю туннель к http://127.0.0.1:$Port" -ForegroundColor Cyan
Write-Host "  Ссылка появится ниже — ищи строку https://*.trycloudflare.com" -ForegroundColor DarkGray
Write-Host "  Ссылка живёт, пока открыто это окно. Ctrl+C — остановить." -ForegroundColor DarkGray
Write-Host ""

& $exe tunnel --url "http://127.0.0.1:$Port" --no-autoupdate
