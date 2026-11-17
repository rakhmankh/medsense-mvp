@echo off
cd /d "%~dp0"
set "MEDSENSE_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%MEDSENSE_NODE%" goto run
set "MEDSENSE_NODE=node"
where node >nul 2>nul
if errorlevel 1 goto missing
:run
echo MedSense: http://localhost:4173
echo Keep this window open. Press Ctrl+C to stop.
"%MEDSENSE_NODE%" "%~dp0server.mjs"
goto end
:missing
echo Install Node.js 24 or later from nodejs.org, then run this file again.
:end
pause
