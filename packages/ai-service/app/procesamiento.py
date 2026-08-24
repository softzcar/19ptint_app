import io
import subprocess
import tempfile
from pathlib import Path

from PIL import Image
from rembg import remove, new_session

from .config import REMBG_MODEL, REALESRGAN_BIN, UPSCALE_SCALE

_session = None


def _get_session():
    global _session
    if _session is None:
        _session = new_session(REMBG_MODEL)
    return _session


def quitar_fondo(imagen_bytes: bytes) -> bytes:
    sin_fondo = remove(imagen_bytes, session=_get_session())
    im = Image.open(io.BytesIO(sin_fondo)).convert("RGBA")

    # CONTEXTO.md §7 preprocesamiento paso 1: recortar al bounding box real
    # usando el canal alfa, elimina espacio transparente desperdiciado.
    bbox = im.split()[-1].getbbox()
    if bbox:
        im = im.crop(bbox)

    salida = io.BytesIO()
    im.save(salida, format="PNG")
    return salida.getvalue()


def upscale(imagen_bytes: bytes) -> bytes:
    if not REALESRGAN_BIN.exists():
        raise RuntimeError(
            f"No se encontró el binario de realesrgan-ncnn-vulkan en {REALESRGAN_BIN}. "
            "Correr scripts/setup-ai-service.sh para descargarlo."
        )

    with tempfile.TemporaryDirectory() as tmp:
        entrada = Path(tmp) / "in.png"
        salida = Path(tmp) / "out.png"
        Image.open(io.BytesIO(imagen_bytes)).convert("RGBA").save(entrada)

        subprocess.run(
            [str(REALESRGAN_BIN), "-i", str(entrada), "-o", str(salida), "-n", "realesrgan-x4plus"],
            cwd=REALESRGAN_BIN.parent,
            check=True,
            capture_output=True,
        )

        im = Image.open(salida).convert("RGBA")
        # El binario escala fijo 4x; se reescala al factor configurado (2x
        # por defecto, CONTEXTO.md §5) manteniendo la nitidez del modelo x4.
        original = Image.open(io.BytesIO(imagen_bytes))
        destino = (original.width * UPSCALE_SCALE, original.height * UPSCALE_SCALE)
        im = im.resize(destino, Image.LANCZOS)

        buf = io.BytesIO()
        im.save(buf, format="PNG")
        return buf.getvalue()
