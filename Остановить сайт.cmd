@echo off
title Gruppa 05-605 - stopping
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-all.ps1"
ping -n 4 127.0.0.1 >nul
