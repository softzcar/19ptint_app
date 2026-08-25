import os
import platform
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent

# CONTEXTO.md §5: limitar tamaño de imagen de entrada para controlar tiempos en CPU.
MAX_LADO_PX = int(os.environ.get("MAX_LADO_PX", "4000"))

# CONTEXTO.md §5: modelo liviano de rembg, evitar BiRefNet completo.
REMBG_MODEL = os.environ.get("REMBG_MODEL", "u2netp")

UPSCALE_SCALE = int(os.environ.get("UPSCALE_SCALE", "2"))

_PLATFORM_DIR = "macos" if platform.system() == "Darwin" else "ubuntu"
REALESRGAN_BIN = Path(
    os.environ.get("REALESRGAN_BIN", APP_DIR / "bin" / _PLATFORM_DIR / "realesrgan-ncnn-vulkan")
)
