@echo off
setlocal
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
set ELECTRON_NO_ASAR=
rem Modo de diagnostico: expoe a superficie separada pkaDiag (simulacao local).
rem Nao e funcionamento no jogo. O namespace pka recuperado nao muda.
set PKA_DIAGNOSTICS=1
"%~dp0runtime\electron-v44.7.2\electron.exe" "%~dp0reconstruction\app"
if errorlevel 1 goto failed
exit /b 0
:failed
echo Falha ao abrir a reconstrucao (modo diagnostico). Confira a mensagem acima.
pause
exit /b 1
