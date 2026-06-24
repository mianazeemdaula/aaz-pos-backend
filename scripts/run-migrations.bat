@echo off
title Update Database - AAZ POS
cd /d "%~dp0"

echo ========================================
echo   AAZ POS - Update Database Schema
echo ========================================
echo.

set EXE_NAME=posserver.exe
if not exist "%EXE_NAME%" (
    set EXE_NAME=cold-storage.exe
)

if not exist "%EXE_NAME%" (
    echo Error: Could not find posserver.exe or cold-storage.exe in this directory.
    echo Please make sure this file is placed in the same folder as the server executable.
    pause
    exit /b 1
)

echo Found executable: %EXE_NAME%
echo Running database migrations...
echo ----------------------------------------
"%EXE_NAME%" --migrate
echo ----------------------------------------
echo.
echo Database update finished.
echo ========================================
pause
