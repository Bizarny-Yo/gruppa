# Публичная HTTPS-ссылка через serveo.net — без аккаунта и без денег.
# На этой сети (провайдер/роутер) Cloudflare-туннели не регистрируются,
# а serveo работает. Важно: цель указываем как 127.0.0.1, а не localhost —
# иначе Windows резолвит в IPv6 ::1 и получается 502.
#
# Запуск:  powershell -ExecutionPolicy Bypass -File scripts/tunnel-serveo.ps1
# Ссылка живёт, пока открыто это окно и включён компьютер.
# Бесплатный serveo показывает посетителям страницу-предупреждение.

param([int]$Port = 47824)

$ssh = "C:\WINDOWS\System32\OpenSSH\ssh.exe"
if (-not (Test-Path $ssh)) {
  $cmd = Get-Command ssh -ErrorAction SilentlyContinue
  if ($cmd) { $ssh = $cmd.Source } else { Write-Host "OpenSSH не найден" -ForegroundColor Red; exit 1 }
}

Write-Host ""
Write-Host "  Поднимаю туннель к http://127.0.0.1:$Port" -ForegroundColor Cyan
Write-Host "  Ссылка появится ниже — ищи строку https://...serveousercontent.com" -ForegroundColor DarkGray
Write-Host "  Ctrl+C — остановить." -ForegroundColor DarkGray
Write-Host ""

& $ssh -o StrictHostKeyChecking=accept-new -o ExitOnForwardFailure=yes `
  -o ServerAliveInterval=30 -R "80:127.0.0.1:$Port" serveo.net
