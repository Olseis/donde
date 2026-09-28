@echo off
setlocal
cd /d "%~dp0"
echo ============================================
echo   Configuracion inicial del proyecto
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado. Descargalo de https://nodejs.org
  pause
  exit /b 1
)

if not exist "www\index.html" (
  echo [ERROR] No se encuentra www\index.html
  echo Pon este script en la raiz del proyecto, junto a package.json
  pause
  exit /b 1
)

echo [1/4] Instalando dependencias...
call npm install
if errorlevel 1 goto error

if exist "android" goto androidok
echo [2/4] Creando proyecto Android...
call npx cap add android
if errorlevel 1 goto error
if not exist "assets\icon.png" goto sdk
echo Generando iconos...
call npx @capacitor/assets generate --android
if errorlevel 1 goto error
goto sdk

:androidok
echo [2/4] La carpeta android ya existe, se omite.

:sdk
echo [3/4] Buscando el SDK de Android...
set "SDK=%ANDROID_HOME%"
if "%SDK%"=="" set "SDK=%LOCALAPPDATA%\Android\Sdk"
if not exist "%SDK%" goto nosdk
set "SDKFWD=%SDK:\=/%"
> "android\local.properties" echo sdk.dir=%SDKFWD%
echo SDK encontrado: %SDK%
goto sync

:nosdk
echo [AVISO] No se encontro el SDK de Android.
echo Instalalo desde Android Studio: tres puntos - SDK Manager.
echo Despues vuelve a ejecutar este script.

:sync
echo [4/4] Sincronizando el juego con Android...
call npx cap sync android
if errorlevel 1 goto error

echo.
echo ============================================
echo   Listo
echo ============================================
choice /c SN /m "Abrir Android Studio ahora"
if errorlevel 2 goto end
call npx cap open android
goto end

:error
echo.
echo [ERROR] Algo ha fallado. Revisa el mensaje de arriba.
pause
exit /b 1

:end
pause
