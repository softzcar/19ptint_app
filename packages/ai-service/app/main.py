from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import Response
from PIL import Image
import io

from .config import MAX_LADO_PX, MAX_MEGAPIXELES
from . import procesamiento

app = FastAPI(title="19print AI service")


async def _leer_y_validar(file: UploadFile) -> bytes:
    data = await file.read()
    try:
        im = Image.open(io.BytesIO(data))
        im.verify()
    except Exception:
        raise HTTPException(400, "Archivo no es una imagen válida")
    im = Image.open(io.BytesIO(data))
    if im.width > MAX_LADO_PX or im.height > MAX_LADO_PX:
        raise HTTPException(400, f"La imagen excede el máximo de {MAX_LADO_PX}px por lado")
    # El área es lo que realmente consume memoria y tiempo de CPU: un banner
    # de 12000x400 son 4.8MP (inofensivo) y un 12000x12000 son 144MP.
    megapixeles = (im.width * im.height) / 1_000_000
    if megapixeles > MAX_MEGAPIXELES:
        raise HTTPException(
            400,
            f"La imagen tiene {megapixeles:.1f} megapíxeles y el máximo es {MAX_MEGAPIXELES}",
        )
    return data


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/quitar-fondo")
async def quitar_fondo(file: UploadFile = File(...)):
    data = await _leer_y_validar(file)
    try:
        resultado = procesamiento.quitar_fondo(data)
    except Exception as e:
        raise HTTPException(500, f"Error quitando fondo: {e}")
    return Response(content=resultado, media_type="image/png")


@app.post("/upscale")
async def upscale(file: UploadFile = File(...)):
    data = await _leer_y_validar(file)
    try:
        resultado = procesamiento.upscale(data)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except Exception as e:
        raise HTTPException(500, f"Error en upscale: {e}")
    return Response(content=resultado, media_type="image/png")
