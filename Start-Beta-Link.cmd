@echo off
cd /d "%~dp0"
set "MEDSENSE_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%MEDSENSE_NODE%" goto run
set "MEDSENSE_NODE=node"
where node >nul 2>nul
if errorlevel 1 goto missing
:run
echo MedSense remote beta. Keep this window open.
"%MEDSENSE_NODE%" "%~dp0tools\share-beta.mjs"
goto end
:missing
echo Node.js 24 or later is required.
:end
pause
