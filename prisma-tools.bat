@echo off
title Prisma Tools - Cold Storage
cd /d "%~dp0"

:menu
cls
echo ========================================
echo   Prisma Tools - Cold Storage
echo ========================================
echo.
echo   1. Generate Client       (prisma generate)
echo   2. Push Schema to DB     (prisma db push)
echo   3. Create Migration      (prisma migrate dev)
echo   4. Deploy Migrations     (prisma migrate deploy)
echo   5. Migration Status      (prisma migrate status)
echo   6. Reset Database        (prisma migrate reset)
echo   7. Seed Database         (npm run prisma:seed)
echo   8. Open Prisma Studio    (prisma studio)
echo   9. Validate Schema       (prisma validate)
echo   0. Exit
echo.
echo ========================================
choice /C 1234567890 /N /M "Select an option: "

if errorlevel 10 goto :exit
if errorlevel 9 goto :validate
if errorlevel 8 goto :studio
if errorlevel 7 goto :seed
if errorlevel 6 goto :reset
if errorlevel 5 goto :status
if errorlevel 4 goto :deploy
if errorlevel 3 goto :migrate
if errorlevel 2 goto :push
if errorlevel 1 goto :generate

:generate
echo.
echo Running: npx prisma generate
echo ----------------------------------------
call npx prisma generate
goto :done

:push
echo.
echo Running: npx prisma db push
echo ----------------------------------------
echo This will push the schema to the database without creating a migration.
choice /C YN /M "Continue"
if errorlevel 2 goto :menu
call npx prisma db push
goto :done

:migrate
echo.
set /p MIGRATION_NAME="Enter migration name (or press Enter for default): "
if "%MIGRATION_NAME%"=="" (
    echo Running: npx prisma migrate dev
    echo ----------------------------------------
    call npx prisma migrate dev
) else (
    echo Running: npx prisma migrate dev --name %MIGRATION_NAME%
    echo ----------------------------------------
    call npx prisma migrate dev --name %MIGRATION_NAME%
)
goto :done

:deploy
echo.
echo Running: npx prisma migrate deploy
echo ----------------------------------------
call npx prisma migrate deploy
goto :done

:status
echo.
echo Running: npx prisma migrate status
echo ----------------------------------------
call npx prisma migrate status
goto :done

:reset
echo.
echo WARNING: This will ERASE all data and re-apply migrations!
choice /C YN /M "Are you sure"
if errorlevel 2 goto :menu
echo Running: npx prisma migrate reset
echo ----------------------------------------
call npx prisma migrate reset
goto :done

:seed
echo.
echo Running: npm run prisma:seed
echo ----------------------------------------
call npm run prisma:seed
goto :done

:studio
echo.
echo Running: npx prisma studio
echo ----------------------------------------
call npx prisma studio
goto :done

:validate
echo.
echo Running: npx prisma validate
echo ----------------------------------------
call npx prisma validate
goto :done

:done
echo.
echo ========================================
echo   Command finished.
echo ========================================
pause
goto :menu

:exit
echo Goodbye!
exit /b 0
