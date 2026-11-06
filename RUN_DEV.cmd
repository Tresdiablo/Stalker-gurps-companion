@echo off
rem Development run without building an installer (requires Node.js 22+ on PATH).
cd /d "%~dp0"
if not exist node_modules\electron (
  call npm install --no-audit --no-fund || goto :err
)
call npm start
exit /b 0
:err
echo npm install failed.
pause
