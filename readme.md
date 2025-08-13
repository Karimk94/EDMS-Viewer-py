EDMS Document Viewer
This is a standalone web application for browsing documents from an Oracle database and viewing their corresponding images from an EDMS. It is the primary user interface for the system.
Features
Connects to Oracle to fetch a paginated list of documents.
Searches documents by abstract.
Fetches images from EDMS and creates a local thumbnail_cache inside this project for fast loading.
Communicates with the separate Face Recognition Service to analyze images.
Setup
Configure Credentials: Edit the .env file and fill in your Oracle and EDMS credentials.
Run Setup: Double-click setup.bat to create a virtual environment and install the required libraries.
How to Run
Make sure the separate Face Recognition Service is already running.
Double-click the run.bat file.
Open your web browser and go to http://127.0.0.1:5000.
