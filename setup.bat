@echo off
echo.
echo =======================================================
echo =  Setting up EDMS Document Viewer...
echo =======================================================
echo.

echo [1/2] Creating Python virtual environment ('venv')...
python -m venv venv
if %errorlevel% neq 0 (
echo ERROR: Failed to create virtual environment.
pause
exit /b
)
echo.

echo [2/2] Installing required Python libraries...
call venv\Scripts\activate.bat
pip install -r requirements.txt
if %errorlevel% neq 0 (
echo ERROR: Failed to install Python libraries.
pause
exit /b
)
echo.

echo =======================================================
echo =  Setup Complete!
echo =======================================================
echo You can now run the application using the 'run.bat' script.
echo.
pause