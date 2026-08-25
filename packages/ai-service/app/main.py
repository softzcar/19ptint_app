from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import Response
from PIL import Image
import io

from .config import MAX_LADO_PX
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
