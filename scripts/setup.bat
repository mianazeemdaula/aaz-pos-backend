@echo off
REM Setup script for Cold Storage application

echo ========================================
echo Cold Storage - Initial Setup
echo ========================================
echo.

REM Check if .env file exists
if exist ".env" (
    echo .env file already exists.
    choice /C YN /M "Do you want to overwrite it"
    if errorlevel 2 goto :skip_env
)

REM Copy .env.example to .env
echo Creating .env file from template...
copy .env.example .env

echo.
echo ========================================
echo .env file created successfully!
echo ========================================
echo.
echo Please edit the .env file and configure:
echo   1. DATABASE_URL - Your PostgreSQL connection string
echo   2. JWT_SECRET - A secure secret key for authentication
echo   3. PORT - Server port (default: 3000)
echo.
echo After configuration, run first: cold-storage.exe --migrate --seed
echo Then start app with: cold-storage.exe
echo ========================================
pause
goto :end

:skip_env
echo Skipping .env creation...

:end
