@echo off
setlocal
set "PGBIN=C:\laragon\bin\postgresql\postgresql\bin"
set "PGDATA=C:\laragon\data\postgresql"
set "PATH=%PGBIN%;C:\Windows\System32;C:\Windows"

"%PGBIN%\pg_ctl.exe" -D "%PGDATA%" stop -m fast
exit /b %ERRORLEVEL%
