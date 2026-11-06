@echo off
cd /d "%~dp0"
echo S.T.A.L.K.E.R. GURPS Companion
where npm >nul 2>&1 || (echo Node.js/npm not found. Install Node.js LTS from https://nodejs.org/ & pause & exit /b 1)
if not exist "node_modules\electron" (
  call npm install
  if errorlevel 1 (echo Failed to install dependencies. & pause & exit /b 1)
)
call npm start
if errorlevel 1 pause
