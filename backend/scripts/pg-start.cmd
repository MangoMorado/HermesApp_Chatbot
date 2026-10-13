@echo off
setlocal
REM Arranca el Postgres de Laragon con PATH minimo.
REM Evita 0xC0000142 (STATUS_DLL_INIT_FAILED) cuando el PATH trae el libpq.dll de PHP
REM delante del de PostgreSQL. Preferible: Start All en Laragon; este script es el
REM atajo cuando hay que levantarlo desde terminal o un agente.

set "PGBIN=C:\laragon\bin\postgresql\postgresql\bin"
set "PGDATA=C:\laragon\data\postgresql"
set "LOG=C:\laragon\tmp\postgres-laragon.log"

if not exist "%PGBIN%\pg_ctl.exe" (
  echo No se encontro Postgres en %PGBIN%
  echo Instala PostgreSQL desde Laragon: Menu - Tools - Quick add - postgresql
  exit /b 1
)

if not exist "%PGDATA%\postgresql.conf" (
  echo No hay cluster en %PGDATA%
  echo Arranca PostgreSQL una vez desde Laragon para inicializarlo.
  exit /b 1
)

REM PATH solo sistema + bin de Postgres (sin PHP/Node/Git de Laragon).
set "PATH=%PGBIN%;C:\Windows\System32;C:\Windows;C:\Windows\System32\Wbem"

"%PGBIN%\pg_isready.exe" -h 127.0.0.1 -p 5432 >nul 2>&1
if not errorlevel 1 (
  echo Postgres ya acepta conexiones en 127.0.0.1:5432
  exit /b 0
)

if not exist "C:\laragon\tmp" mkdir "C:\laragon\tmp"

echo Limpieza de instancia previa...
"%PGBIN%\pg_ctl.exe" -D "%PGDATA%" stop -m fast >nul 2>&1
if exist "%PGDATA%\postmaster.pid" del /f "%PGDATA%\postmaster.pid" >nul 2>&1
taskkill /F /IM postgres.exe >nul 2>&1

echo Arrancando Postgres Laragon...
"%PGBIN%\pg_ctl.exe" -D "%PGDATA%" -l "%LOG%" -w start
if errorlevel 1 (
  echo Fallo al arrancar. Ultimas lineas del log:
  if exist "%LOG%" more +0 "%LOG%"
  exit /b 1
)

"%PGBIN%\pg_isready.exe" -h 127.0.0.1 -p 5432
if errorlevel 1 (
  echo Arranco pero no acepta conexiones.
  exit /b 1
)

echo OK: Postgres listo en 127.0.0.1:5432
exit /b 0
