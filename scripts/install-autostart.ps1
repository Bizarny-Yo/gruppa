# Ставит автозапуск приложения при входе в Windows.
# После этого сайт работает без DSH: закрыл харнесс — сайт жив.
#
# Установить:   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
# Удалить:      powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Uninstall

param([switch]$Uninstall)

$repo = Split-Path -Parent $PSScriptRoot
$startup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$vbs = Join-Path $startup "gruppa-autostart.vbs"

if ($Uninstall) {
  if (Test-Path $vbs) {
    Remove-Item $vbs -Force
    Write-Host "Автозапуск удалён: $vbs" -ForegroundColor Yellow
  } else {
    Write-Host "Автозапуск не был установлен" -ForegroundColor DarkGray
  }
  exit 0
}

$runner = Join-Path $repo "scripts\run-all.ps1"
if (-not (Test-Path $runner)) {
  Write-Host "Не найден scripts\run-all.ps1" -ForegroundColor Red
  exit 1
}

# VBS нужен, чтобы PowerShell стартовал скрыто, без окна
$content = @"
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$runner""", 0, False
"@

# Юникод обязателен: в пути есть кириллица («Документы»)
Set-Content -Path $vbs -Value $content -Encoding Unicode

Write-Host ""
Write-Host "  Автозапуск установлен" -ForegroundColor Green
Write-Host "  Файл: $vbs"
Write-Host ""
Write-Host "  Что это значит: при следующем входе в Windows сайт поднимется сам," -ForegroundColor DarkGray
Write-Host "  сервер и туннель будут работать без DSH." -ForegroundColor DarkGray
Write-Host "  Прямо сейчас ничего не запускается — только при следующем входе." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Удалить: powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Uninstall" -ForegroundColor DarkGray
