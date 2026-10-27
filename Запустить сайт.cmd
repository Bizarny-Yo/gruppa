@echo off
title Gruppa 05-605 - site is running
color 0B
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-all.ps1"
echo.
pause
