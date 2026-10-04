@echo off
REM ─────────────────────────────────────────────────────────────────────────
REM  UniVicoustic configurator — start backend + frontend
REM
REM  Uses %~dp0 (the dir this .bat lives in) so it works regardless of
REM  where the project root is on disk. Launches two terminals so you can
REM  see logs from each service separately; close a window to stop that
REM  service.
REM ─────────────────────────────────────────────────────────────────────────

setlocal

REM Project root = directory containing this script
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "BACKEND=%ROOT%\backend"
set "FRONTEND=%ROOT%\frontend"

REM ── Pre-flight checks ────────────────────────────────────────────────────
if not exist "%BACKEND%\server.py" (
    echo [ERROR] backend\server.py not found at: %BACKEND%
    echo Make sure this script lives in the project root.
    pause
    exit /b 1
)
if not exist "%FRONTEND%\package.json" (
    echo [ERROR] frontend\package.json not found at: %FRONTEND%
    pause
    exit /b 1
)
if not exist "%BACKEND%\myenv\Scripts\activate.bat" (
    echo [ERROR] Python venv 'myenv' not found at: %BACKEND%\myenv
    echo.
    echo Create it first:
    echo   cd "%BACKEND%"
    echo   py -3.14 -m venv myenv
    echo   myenv\Scripts\activate
    echo   pip install -r requirements.txt
    pause
    exit /b 1
)
if not exist "%FRONTEND%\node_modules" (
    echo [WARN] frontend\node_modules not found. Frontend will likely fail.
    echo Run: cd "%FRONTEND%" ^&^& npm install
    echo.
    echo Press any key to launch anyway, or Ctrl+C to abort.
    pause >nul
)

REM ── Launch ───────────────────────────────────────────────────────────────
echo Starting backend...
start "UniVicoustic Backend" cmd /k "cd /d ""%BACKEND%"" && call myenv\Scripts\activate && python server.py"

echo Starting frontend...
start "UniVicoustic Frontend" cmd /k "cd /d ""%FRONTEND%"" && npm start"

echo.
echo Both services launched in new windows.
echo   - Backend  → "UniVicoustic Backend" window  (typically http://localhost:8001)
echo   - Frontend → "UniVicoustic Frontend" window (typically http://localhost:3000)
echo.
echo Close a window to stop that service.

endlocal
