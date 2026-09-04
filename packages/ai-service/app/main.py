from fastapi import FastAPI, UploadFile, File, Form, HTTPException
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


@app.post("/efecto-bordado")
async def efecto_bordado(
    file: UploadFile = File(...),
    paso_px: int = Form(6),
    largo_px: int = Form(7),
):
    data = await _leer_y_validar(file)
    try:
        resultado = procesamiento.bordar(data, paso_px=paso_px, largo_px=largo_px)
    except Exception as e:
        raise HTTPException(500, f"Error aplicando efecto bordado: {e}")
    return Response(content=resultado, media_type="image/png")


@app.post("/bordar-contorno")
async def bordar_contorno(
    file: UploadFile = File(...),
    paso_px: int = Form(6),
    largo_px: int = Form(7),
    grosor_contorno_px: int = Form(12),
):
    data = await _leer_y_validar(file)
    try:
        resultado = procesamiento.bordar_contorno(data, paso_px=paso_px, largo_px=largo_px, grosor_contorno_px=grosor_contorno_px)
    except Exception as e:
        raise HTTPException(500, f"Error generando el contorno de bordado: {e}")
    return Response(content=resultado, media_type="image/png")


@app.post("/generar-patron-ia")
async def generar_patron_ia_endpoint(prompt: str = Form(...)):
    try:
        resultado = procesamiento.generar_patron_ia(prompt)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except Exception as e:
        raise HTTPException(500, f"Error generando el patrón con IA: {e}")
    return Response(content=resultado, media_type="image/png")


@app.post("/exportar-tiff-spot")
async def exportar_tiff_spot_endpoint(
    mascara_blanco: UploadFile = File(...),
    mascara_barniz: UploadFile = File(...),
    ancho_mm: float = Form(...),
    alto_mm: float = Form(...),
):
    blanco = await mascara_blanco.read()
    barniz = await mascara_barniz.read()
    try:
        resultado = procesamiento.exportar_tiff_spot(blanco, barniz, ancho_mm, alto_mm)
    except Exception as e:
        raise HTTPException(500, f"Error exportando el TIFF: {e}")
    return Response(content=resultado, media_type="image/tiff")


@app.post("/vectorizar")
async def vectorizar(file: UploadFile = File(...)):
    data = await _leer_y_validar(file)
    try:
        svg = procesamiento.vectorizar(data)
    except Exception as e:
        raise HTTPException(500, f"Error vectorizando: {e}")
    return Response(content=svg.encode("utf-8"), media_type="image/svg+xml")


@app.post("/rasterizar-silueta")
async def rasterizar_silueta(
    svg: UploadFile = File(...),
    ancho_px: int = Form(...),
    alto_px: int = Form(...),
):
    svg_texto = (await svg.read()).decode("utf-8")
    try:
        resultado = procesamiento.rasterizar_silueta(svg_texto, ancho_px, alto_px)
    except Exception as e:
        raise HTTPException(500, f"Error rasterizando la silueta: {e}")
    return Response(content=resultado, media_type="image/png")


@app.post("/proponer-capas")
async def proponer_capas(
    file: UploadFile = File(...),
    grosor_relieve_px: int = Form(...),
    sensibilidad: int = Form(...),
):
    data = await _leer_y_validar(file)
    try:
        resultado = procesamiento.proponer_capas(data, grosor_relieve_px, sensibilidad)
    except Exception as e:
        raise HTTPException(500, f"Error proponiendo capas: {e}")
    return Response(content=resultado, media_type="image/png")
