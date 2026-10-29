@echo off
echo =========================================================
echo  Starting Live Location Tracking & Journey Safety System
echo =========================================================
echo.

set PYTHON_CMD=python
where python >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    set PYTHON_CMD=%LOCALAPPDATA%\Programs\Python\Python311\python.exe
)

echo Installing dependencies if needed...
"%PYTHON_CMD%" -m pip install -r requirements.txt

echo.
echo Launching Flask Application Server on http://127.0.0.1:5000 ...
echo.
"%PYTHON_CMD%" app.py
pause
