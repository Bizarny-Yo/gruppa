# Публичная HTTPS-ссылка через serveo.net — без аккаунта и без денег.
#
# Закреплённое имя требует зарегистрированного SSH-ключа:
#   https://console.serveo.net/ssh/keys  (вход через GitHub/Google)
# Ключ этой машины уже привязан к аккаунту, поэтому имя gruppa-pmi21 стабильно.
#
# Важно: цель указываем как 127.0.0.1, а не localhost —
# иначе Windows резолвит в IPv6 ::1 и получается 502.
#
# Бесплатный туннель serveo обрывается по таймауту (~30 мин), поэтому
# скрипт переподключается сам. С закреплённым именем адрес при этом не меняется.
#
# Запуск:  powershell -ExecutionPolicy Bypass -File scripts/tunnel-serveo.ps1

param(
  [int]$Port = 47824,
  [string]$Name = "gruppa-pmi21"
)

$ssh = "C:\WINDOWS\System32\OpenSSH\ssh.exe"
if (-not (Test-Path $ssh)) {
  $cmd = Get-Command ssh -ErrorAction SilentlyContinue
  if ($cmd) { $ssh = $cmd.Source } else { Write-Host "OpenSSH не найден" -ForegroundColor Red; exit 1 }
}

Write-Host ""
Write-Host "  Туннель: https://$Name.serveousercontent.com  →  http://127.0.0.1:$Port" -ForegroundColor Cyan
Write-Host "  Обрывы serveo переживаются автоматически, адрес не меняется." -ForegroundColor DarkGray
Write-Host "  Ctrl+C — остановить." -ForegroundColor DarkGray
Write-Host ""

while ($true) {
  & $ssh -o StrictHostKeyChecking=accept-new -o ExitOnForwardFailure=yes `
    -o ServerAliveInterval=20 -o ServerAliveCountMax=3 `
    -R "${Name}:80:127.0.0.1:$Port" serveo.net
  Write-Host "  туннель закрылся, переподключаюсь через 3с" -ForegroundColor DarkGray
  Start-Sleep -Seconds 3
}
