#!/usr/bin/env bash
# Prepara el microservicio de IA: venv Python + deps + binario de
# realesrgan-ncnn-vulkan (macOS para desarrollo local, Linux queda
# documentado para el VPS en DEPLOY.md).
set -euo pipefail
cd "$(dirname "$0")/../packages/ai-service"

PYTHON_BIN="${PYTHON_BIN:-python3.12}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Instalando python@3.12 vía Homebrew..."
  brew install python@3.12
  PYTHON_BIN="$(brew --prefix python@3.12)/bin/python3.12"
fi

if [ ! -d venv ]; then
  "$PYTHON_BIN" -m venv venv
fi
source venv/bin/activate
pip install --upgrade pip >/dev/null

# cairosvg (DTF UV: rasterizar_silueta) necesita la librería nativa libcairo,
# no solo el paquete pip. En el VPS (AlmaLinux) el equivalente es
# `dnf install cairo` -- ver DEPLOY.md.
if ! python3 -c "import ctypes.util, sys; sys.exit(0 if ctypes.util.find_library('cairo') else 1)" 2>/dev/null; then
  echo "Instalando cairo (libcairo, requerido por cairosvg) vía Homebrew..."
  brew install cairo
fi

pip install -r requirements.txt

# Release "20220424" del repo principal xinntao/Real-ESRGAN: es la que trae
# los modelos (.param/.bin) empaquetados junto al binario ncnn-vulkan.
REALESRGAN_TAG="v0.2.5.0"
REALESRGAN_BUILD="20220424"
mkdir -p bin
if [ ! -x "bin/macos/realesrgan-ncnn-vulkan" ] || [ ! -f "bin/macos/models/realesrgan-x4plus.bin" ]; then
  echo "Descargando realesrgan-ncnn-vulkan (macOS, con modelos)..."
  tmp="$(mktemp -d)"
  curl -sL "https://github.com/xinntao/Real-ESRGAN/releases/download/${REALESRGAN_TAG}/realesrgan-ncnn-vulkan-${REALESRGAN_BUILD}-macos.zip" -o "$tmp/macos.zip"
  mkdir -p bin/macos
  unzip -q -o "$tmp/macos.zip" -d bin/macos
  chmod +x bin/macos/realesrgan-ncnn-vulkan
  rm -rf "$tmp"
fi

echo "listo. Para correr el servicio: cd packages/ai-service && source venv/bin/activate && uvicorn app.main:app --port 8000"
echo "(el binario Linux para el VPS se descarga igual, cambiando 'macos' por 'ubuntu' — ver DEPLOY.md)"
