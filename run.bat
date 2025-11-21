@echo off
REM Script to run video upload automation
REM Usage: run.bat

echo Starting video upload process...

REM Run the upload command
call npm run upload

REM Check exit status
if %ERRORLEVEL% EQU 0 (
    echo Upload process completed successfully
    exit /b 0
) else (
    echo Upload process failed
    exit /b 1
)

