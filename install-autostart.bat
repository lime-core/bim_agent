@echo off
set AGENT_DIR=%~dp0
set NODE_EXE=C:\Program Files\nodejs\node.exe
set TSX=%AGENT_DIR%node_modules\.bin\tsx

schtasks /create /tn "BIM Agent" /tr "\"%NODE_EXE%\" \"%TSX%\" src\index.ts" /sc onstart /ru SYSTEM /rl highest /f /sd 01/01/2000 /st 00:00

if %errorlevel% == 0 (
    echo Автозапуск успешно настроен.
    echo Агент будет запускаться автоматически при старте Windows.
) else (
    echo Ошибка при настройке автозапуска.
    echo Запустите этот файл от имени администратора.
)
pause
