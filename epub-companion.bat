@echo off
cd /d "%~dp0"

echo Building epub-companion...
call npm run build
if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
)

start "" "http://localhost:3001"
node --no-warnings dist/server/index.js
