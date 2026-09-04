import os
import platform
from pathlib import Path

from dotenv import load_dotenv

APP_DIR = Path(__file__).resolve().parent.parent
load_dotenv(APP_DIR / ".env")

# CONTEXTO.md §5: limitar tamaño de imagen de entrada para controlar tiempos en CPU.
# Debe acompañar al límite del backend (routes/imagenes.js), que ya normaliza
# todo lo que entra: si acá quedara más bajo, este servicio rechazaría
# imágenes que el backend ya dio por válidas. Es la red de seguridad, no el
# límite principal.
MAX_LADO_PX = int(os.environ.get("MAX_LADO_PX", "12000"))
MAX_MEGAPIXELES = int(os.environ.get("MAX_MEGAPIXELES", "60"))

# CONTEXTO.md §5: modelo liviano de rembg, evitar BiRefNet completo.
REMBG_MODEL = os.environ.get("REMBG_MODEL", "u2netp")

UPSCALE_SCALE = int(os.environ.get("UPSCALE_SCALE", "2"))

# DTF UV: generar_patron_ia() en procesamiento.py. Sin esta key, ese único
# endpoint devuelve 503 -- el resto del servicio funciona igual.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-image")

_PLATFORM_DIR = "macos" if platform.system() == "Darwin" else "ubuntu"
REALESRGAN_BIN = Path(
    os.environ.get("REALESRGAN_BIN", APP_DIR / "bin" / _PLATFORM_DIR / "realesrgan-ncnn-vulkan")
)
