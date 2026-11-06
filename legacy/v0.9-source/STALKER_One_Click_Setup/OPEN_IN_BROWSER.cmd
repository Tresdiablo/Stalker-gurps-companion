@echo off
cd /d "%~dp0"
if not exist "App\index.html" (
  echo Missing App\index.html. Extract the entire ZIP first.
  pause
  exit /b 1
)
start "" "%~dp0App\index.html"
