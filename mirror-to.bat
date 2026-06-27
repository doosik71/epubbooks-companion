@echo off

cd /d %~dp0

if "%~1"=="" (
    echo Usage: mirror-to.bat ^<destination^>
    echo Example: mirror-to.bat F:\epub-companion
    exit /b 1
)
robocopy data "%~1" /E /XN /XO
