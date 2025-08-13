@echo off
echo Activating virtual environment...
call venv\Scripts\activate.bat
echo.
echo Starting the EDMS Viewer Flask server...
echo You can access the application in your web browser at http://127.0.0.1:5000
echo Press Ctrl+C in this window to stop the server.
echo.
python app.py
