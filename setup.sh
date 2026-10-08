#!/usr/bin/env bash
# Configuración inicial del proyecto (Mac y Linux)
# Uso: ./setup.sh
set -e
cd "$(dirname "$0")"

echo "============================================"
echo "  Configuración inicial del proyecto"
echo "============================================"
echo

ES_MAC=false
if [[ "$OSTYPE" == darwin* ]]; then ES_MAC=true; fi

# --- Comprobaciones ---
if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js no está instalado. Descárgalo de https://nodejs.org"
  exit 1
fi

if [ ! -f "www/index.html" ]; then
  echo "[ERROR] No se encuentra www/index.html"
  echo "Pon este script en la raíz del proyecto, junto a package.json"
  exit 1
fi

# --- Dependencias ---
echo "[1/5] Instalando dependencias..."
npm install

# --- Android ---
echo "[2/5] Preparando Android..."
if [ ! -d "android" ]; then
  npx cap add android
  if [ -f "assets/icon.png" ]; then
    npx @capacitor/assets generate --android
  fi
else
  echo "La carpeta android ya existe, se omite."
fi

# --- SDK de Android ---
echo "[3/5] Buscando el SDK de Android..."
if $ES_MAC; then
  SDK_DEFECTO="$HOME/Library/Android/sdk"
else
  SDK_DEFECTO="$HOME/Android/Sdk"
fi
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$SDK_DEFECTO}}"
if [ -d "$SDK" ]; then
  echo "sdk.dir=$SDK" > android/local.properties
  echo "SDK encontrado: $SDK"
else
  echo "[AVISO] No se encontró el SDK de Android."
  echo "Instálalo desde Android Studio: More Actions → SDK Manager."
fi

# --- iOS (solo Mac con Xcode) ---
IOS_OK=false
echo "[4/5] Preparando iOS..."
if $ES_MAC && command -v xcodebuild >/dev/null 2>&1; then
  if ! npm ls @capacitor/ios >/dev/null 2>&1; then
    npm install @capacitor/ios
  fi
  if [ ! -d "ios" ]; then
    npx cap add ios
    if [ -f "assets/icon.png" ]; then
      npx @capacitor/assets generate --ios
    fi
  else
    echo "La carpeta ios ya existe, se omite."
  fi
  IOS_OK=true
elif $ES_MAC; then
  echo "[AVISO] Xcode no está instalado. Instálalo desde la App Store para usar iOS."
else
  echo "iOS solo se puede compilar en Mac, se omite."
fi

# --- Sincronizar ---
echo "[5/5] Sincronizando el juego..."
npx cap sync android
if $IOS_OK; then
  npx cap sync ios
fi

echo
echo "============================================"
echo "  Listo"
echo "============================================"
if $IOS_OK; then
  read -r -p "¿Qué quieres abrir? (a = Android Studio, i = Xcode, n = nada) " RESP
  case "$RESP" in
    a|A) npx cap open android ;;
    i|I) npx cap open ios ;;
  esac
else
  read -r -p "¿Abrir Android Studio ahora? (s/n) " RESP
  if [[ "$RESP" =~ ^[sS]$ ]]; then
    npx cap open android
  fi
fi
