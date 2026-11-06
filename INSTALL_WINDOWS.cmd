@echo off
setlocal
cd /d "%~dp0"
title STALKER GURPS Companion - One Click Setup

echo.
echo  S.T.A.L.K.E.R. GURPS Companion
echo  Windows one-click installation
echo  --------------------------------
echo.

if not exist "%~dp0package.json" (
    echo ERROR: App files are missing. Extract the entire ZIP before running this installer.
    pause
    exit /b 1
)

where powershell.exe >nul 2>&1
if errorlevel 1 (
    echo ERROR: Windows PowerShell is required for installation.
    pause
    exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install-windows.ps1"
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" (
    echo.
    echo Installation did not finish. Read the error above and the installation log.
    pause
)
exit /b %RESULT%
