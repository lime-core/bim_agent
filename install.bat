@echo off
setlocal enabledelayedexpansion
cd /d %~dp0

echo ========================================
echo   BIM Agent - Установка
echo ========================================
echo.

:: ── 1. Проверяем Node.js ─────────────────────────────────────────────────────

where node >nul 2>&1
if %errorlevel% == 0 (
    for /f "tokens=*" %%v in ('node --version 2^>^&1') do set NODE_VER=%%v
    echo [OK] Node.js уже установлен: !NODE_VER!
    goto :install_deps
)

echo [!] Node.js не найден. Устанавливаем...
echo.

:: Пробуем winget (доступен на Windows 10/11 с обновлениями 2021+)
where winget >nul 2>&1
if %errorlevel% == 0 (
    echo Установка через winget...
    winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    if !errorlevel! == 0 (
        echo.
        echo [OK] Node.js установлен.
        echo [!] Закройте это окно и запустите install.bat снова, чтобы применились пути.
        pause
        exit /b 0
    )
    echo [!] winget не смог установить Node.js. Попробуем вручную...
    echo.
)

:: Скачиваем установщик через PowerShell
echo Скачиваем установщик Node.js LTS...
set INSTALLER=%TEMP%\node-lts-x64.msi

powershell -NoProfile -Command ^
    "$v = (Invoke-RestMethod 'https://nodejs.org/dist/index.json' | Where-Object {$_.lts} | Select-Object -First 1).version;" ^
    "Invoke-WebRequest -Uri \"https://nodejs.org/dist/$v/node-$v-x64.msi\" -OutFile '%INSTALLER%'" ^
    2>nul

if not exist "%INSTALLER%" (
    echo.
    echo [ОШИБКА] Не удалось скачать Node.js автоматически.
    echo Скачайте вручную: https://nodejs.org/  ^(LTS версия, Windows Installer^)
    echo После установки запустите install.bat снова.
    pause
    exit /b 1
)

echo Запускаем установщик...
msiexec /i "%INSTALLER%" /qn ADDLOCAL=ALL
if !errorlevel! == 0 (
    del "%INSTALLER%" 2>nul
    echo.
    echo [OK] Node.js установлен.
    echo [!] Закройте это окно и запустите install.bat снова, чтобы применились пути.
    pause
    exit /b 0
) else (
    echo [ОШИБКА] Установка Node.js завершилась с ошибкой.
    echo Установите вручную: https://nodejs.org/
    pause
    exit /b 1
)

:: ── 2. Устанавливаем зависимости ─────────────────────────────────────────────

:install_deps
echo.
echo Устанавливаем зависимости (npm install)...
call npm install
if !errorlevel! neq 0 (
    echo.
    echo [ОШИБКА] npm install завершился с ошибкой.
    pause
    exit /b 1
)
echo [OK] Зависимости установлены.

:: ── 3. Создаём .env если не существует ───────────────────────────────────────

echo.
if exist ".env" (
    echo [OK] Файл .env уже существует.
) else (
    copy ".env.example" ".env" >nul
    echo [OK] Создан файл .env из .env.example
)

:: ── Готово ────────────────────────────────────────────────────────────────────

echo.
echo ========================================
echo   Установка завершена!
echo ========================================
echo.
if not exist ".env" goto :done
findstr /C:"your_api_key_here" ".env" >nul 2>&1
if %errorlevel% == 0 (
    echo [!] Не забудьте заполнить .env:
    echo     - SERVER_URL — адрес EIR-сервера
    echo     - API_KEY    — ключ из раздела "Настройки -> Агенты"
    echo.
    echo После этого запустите start.bat
)

:done
pause
