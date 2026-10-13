@echo off
setlocal
set "PGBIN=C:\laragon\bin\postgresql\postgresql\bin"
set "PGDATA=C:\laragon\data\postgresql"
set "PATH=%PGBIN%;C:\Windows\System32;C:\Windows"

"%PGBIN%\pg_ctl.exe" -D "%PGDATA%" status
"%PGBIN%\pg_isready.exe" -h 127.0.0.1 -p 5432
exit /b %ERRORLEVEL%
