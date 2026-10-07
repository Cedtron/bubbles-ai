@echo off
:: ============================================================================
:: Bubbles AI - Windows Native App Launcher
:: Launches Bubbles AI in standalone desktop app mode using Microsoft Edge or Chrome
:: ============================================================================
title Bubbles AI Desktop App
set APP_URL=%~1
if "%APP_URL%"=="" set APP_URL=http://localhost:3000

echo Launching Bubbles AI Desktop App (%APP_URL%)...

:: Try Microsoft Edge App Mode (Standard on all modern Windows 10/11)
start "" msedge.exe --app=%APP_URL% --window-size=1280,850 --user-data-dir="%LOCALAPPDATA%\BubblesAI\EdgeProfile"
if %errorlevel% equ 0 exit /b 0

:: Fallback to Google Chrome App Mode
start "" chrome.exe --app=%APP_URL% --window-size=1280,850 --user-data-dir="%LOCALAPPDATA%\BubblesAI\ChromeProfile"
if %errorlevel% equ 0 exit /b 0

:: Fallback to Default Browser
start "" "%APP_URL%"
exit /b 0
