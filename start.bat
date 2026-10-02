@echo off
setlocal
cd /d "%~dp0"
title TOWN3 launcher

rem --- Dev server: start only if not already running ------------------------
netstat -ano | findstr "LISTENING" | findstr ":5173" >nul
if %errorlevel%==0 (
  echo Dev server already running on port 5173 - just opening the browser.
  start "" http://localhost:5173/
  goto :llm
)

echo Starting dev server in its own window...
start "TOWN3 server - close this window to stop it" cmd /k npm run dev

rem Wait until the port is up, then open the browser.
for /l %%i in (1,1,30) do (
  netstat -ano | findstr "LISTENING" | findstr ":5173" >nul
  if not errorlevel 1 goto :opened
  ping -n 2 127.0.0.1 >nul
)
echo Server did not start - check the "TOWN3 server" window.
goto :llm

:opened
start "" http://localhost:5173/

:llm
rem --- LM Studio check (optional: council falls back to rules without it) ---
powershell -NoProfile -Command "try { $null = Invoke-WebRequest 'http://127.0.0.1:1234/v1/models' -TimeoutSec 2 -UseBasicParsing; 'LM Studio: ONLINE - LLM council enabled' } catch { 'LM Studio: NOT RUNNING - council will use rules fallback. Start LM Studio and load a model.' }"

echo.
echo All set.
echo   App:      http://localhost:5173
echo   LLM:      works through the built-in /lm proxy (use THIS launcher, not Live Server)
echo   Stop:     close the "TOWN3 server" window  (or press Ctrl+C there, then Y)
echo   Note:     closing the browser tab does NOT stop the server.
ping -n 7 127.0.0.1 >nul
