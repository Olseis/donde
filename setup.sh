#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "============================================"
echo "  Configuración inicial del proyecto"
echo "============================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js no está instalado. Descárgalo de https://nodejs.org"
  exit 1
fi

if [ ! -f "www/index.html" ]; then
  echo "[ERROR] No se encuentra www/index.html"
  echo "Pon este script en la raíz del proyecto, junto a package.json"
  exit 1
fi

echo "[1/4] Instalando dependencias..."
npm install

if [ ! -d "android" ]; then
  echo "[2/4] Creando proyecto Android..."
  npx cap add android
  if [ -f "assets/icon.png" ]; then
    echo "Generando iconos..."
    npx @capacitor/assets generate --android
  fi
else
  echo "[2/4] La carpeta android ya existe, se omite."
fi

echo "[3/4] Buscando el SDK de Android..."
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
if [ -d "$SDK" ]; then
  echo "sdk.dir=$SDK" > android/local.properties
  echo "SDK encontrado: $SDK"
else
  echo "[AVISO] No se encontró el SDK de Android."
  echo "Instálalo desde Android Studio: More Actions → SDK Manager."
  echo "Después vuelve a ejecutar este script."
fi

echo "[4/4] Sincronizando el juego con Android..."
npx cap sync android

echo
echo "============================================"
echo "  Listo"
echo "============================================"
read -r -p "¿Abrir Android Studio ahora? (s/n) " RESP
if [[ "$RESP" =~ ^[sS]$ ]]; then
  npx cap open android
fi
