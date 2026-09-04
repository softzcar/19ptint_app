import io
import subprocess
import tempfile
from pathlib import Path

# CyberPanel VPS sin GPU real (lavapipe/Vulkan por software): un upscale colgado
# puede tardar tanto que satura la memoria/swap de toda la máquina. Cortarlo acá
# para que falle limpio en vez de arrastrar al resto de los sitios del servidor.
UPSCALE_TIMEOUT_S = 300

import base64
import struct

import cairosvg
import cv2
import numpy as np
import requests
import tifffile
import vtracer
from PIL import Image, ImageOps
from rembg import remove, new_session

from .config import REMBG_MODEL, REALESRGAN_BIN, UPSCALE_SCALE, GEMINI_API_KEY, GEMINI_MODEL

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

        try:
            subprocess.run(
                [str(REALESRGAN_BIN), "-i", str(entrada), "-o", str(salida), "-n", "realesrgan-x4plus"],
                cwd=REALESRGAN_BIN.parent,
                check=True,
                capture_output=True,
                timeout=UPSCALE_TIMEOUT_S,
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError(
                f"El upscale tardó más de {UPSCALE_TIMEOUT_S}s y se canceló (VPS sin GPU real)."
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


# Filtro visual (no digitalizado real de máquina bordadora, sin .DST de por
# medio): dibuja puntadas cortas siguiendo la dirección local del arte
# (tangente al borde donde hay contorno marcado, una dirección base fija en
# zonas planas) y modula el brillo de cada puntada según su ángulo respecto a
# una luz fija, simulando el brillo satinado típico del hilo de bordado. El
# canal alfa de entrada NUNCA se toca: la silueta queda igual, solo cambia el
# relleno.
BORDADO_ANGULO_BASE = np.deg2rad(45)
BORDADO_ANGULO_LUZ = np.deg2rad(135)
BORDADO_MAX_LADO_MUESTREO = 1600  # techo de resolución a la que se calculan las puntadas (ver más abajo)


def _bytes_png_orientados(imagen_bytes: bytes) -> bytes:
    """Aplica la orientación EXIF (si la hay) a los píxeles y re-codifica a
    PNG -- ver la nota en vectorizar() sobre por qué hace falta (el
    navegador la respeta al mostrar la imagen, pero Pillow/vtracer no la
    aplican solos, así que sin esto el resultado queda desalineado
    respecto a lo que se ve en pantalla)."""
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(imagen_bytes)))
    salida = io.BytesIO()
    im.save(salida, format="PNG")
    return salida.getvalue()


def _preparar_trabajo(imagen_bytes: bytes):
    """Reduce a resolución de trabajo (ver BORDADO_MAX_LADO_MUESTREO) y
    devuelve la imagen original, la de trabajo, y el factor de escala entre
    ambas -- compartido por bordar() y bordar_contorno()."""
    original = Image.open(io.BytesIO(_bytes_png_orientados(imagen_bytes))).convert("RGBA")
    factor = min(1.0, BORDADO_MAX_LADO_MUESTREO / max(original.width, original.height))
    ancho_trabajo = max(1, round(original.width * factor))
    alto_trabajo = max(1, round(original.height * factor))
    trabajo = original.resize((ancho_trabajo, alto_trabajo), Image.LANCZOS) if factor < 1 else original
    return original, trabajo, factor


def _campo_direccion(rgb_uint8):
    """Ángulo de puntada por píxel: tangente al borde (perpendicular al
    gradiente) donde el contorno es marcado, mezclado hacia un ángulo base
    fijo en zonas planas -- para que el relleno no quede con dirección
    errática por ruido de bajo contraste. Compartido por bordar()/bordar_contorno()."""
    gris = cv2.cvtColor(rgb_uint8, cv2.COLOR_RGB2GRAY)
    gris_suave = cv2.GaussianBlur(gris, (0, 0), sigmaX=2.5)
    gx = cv2.Sobel(gris_suave, cv2.CV_32F, 1, 0, ksize=5)
    gy = cv2.Sobel(gris_suave, cv2.CV_32F, 0, 1, ksize=5)
    magnitud = np.hypot(gx, gy)
    pico = float(magnitud.max()) or 1.0
    angulo_borde = np.arctan2(gy, gx) + np.pi / 2
    peso_borde = np.clip(magnitud / pico * 4, 0, 1)
    return angulo_borde * peso_borde + BORDADO_ANGULO_BASE * (1 - peso_borde)


def bordar(imagen_bytes: bytes, paso_px: int = 6, largo_px: int = 7) -> bytes:
    """paso_px: separación entre puntadas (más chico = más tupido/denso).
    largo_px: medio-largo de cada puntada individual."""
    paso_px = max(2, int(paso_px))
    largo_px = max(1, int(largo_px))
    original, trabajo, factor = _preparar_trabajo(imagen_bytes)
    alpha_original = np.array(original.split()[-1])

    rgb = np.array(trabajo.convert("RGB")).astype(np.float32)
    alpha = np.array(trabajo.split()[-1])
    angulo = _campo_direccion(rgb.astype(np.uint8))

    lienzo = rgb.copy()
    alto, ancho = alpha.shape
    for y in range(0, alto, paso_px):
        fila_alpha = alpha[y]
        for x in range(0, ancho, paso_px):
            if fila_alpha[x] == 0:
                continue
            a = float(angulo[y, x])
            dx = largo_px * np.cos(a)
            dy = largo_px * np.sin(a)
            brillo = 0.6 + 0.4 * abs(np.cos(a - BORDADO_ANGULO_LUZ))
            color = np.clip(rgb[y, x] * brillo, 0, 255)
            cv2.line(
                lienzo,
                (int(round(x - dx)), int(round(y - dy))),
                (int(round(x + dx)), int(round(y + dy))),
                tuple(float(c) for c in color),
                thickness=2,
                lineType=cv2.LINE_AA,
            )

    resultado = Image.fromarray(np.clip(lienzo, 0, 255).astype(np.uint8), mode="RGB").convert("RGBA")
    if factor < 1:
        resultado = resultado.resize((original.width, original.height), Image.LANCZOS)
    resultado.putalpha(Image.fromarray(alpha_original))

    salida = io.BytesIO()
    resultado.save(salida, format="PNG")
    return salida.getvalue()


def bordar_contorno(imagen_bytes: bytes, paso_px: int = 6, largo_px: int = 7, grosor_contorno_px: int = 12) -> bytes:
    """Segunda capa de bordado, pensada como punto de partida para la capa
    spot blanco (Spot1/Spot2): el relieve de puntada en TODOS los bordes
    marcados del dibujo -- silueta exterior, pero también letras y líneas
    internas del logo/dibujo -- sin rellenar rellenos sólidos grandes ni el
    fondo. Detecta bordes reales (Canny) en vez de solo medir distancia al
    borde de la silueta, así el contorno de una letra interior o una línea
    de un dibujo también entra, no solo el perímetro exterior. A diferencia
    de bordar(), la salida es un PNG plano de un canal (gris = intensidad,
    opaco) -- la MISMA convención que ya usa proponer_capas()/el editor de
    capas, así se puede guardar directo como ruta_mascara_blanco."""
    paso_px = max(2, int(paso_px))
    largo_px = max(1, int(largo_px))
    grosor_contorno_px = max(1, int(grosor_contorno_px))
    original, trabajo, factor = _preparar_trabajo(imagen_bytes)
    grosor_trabajo = max(1, round(grosor_contorno_px * factor))

    rgb = np.array(trabajo.convert("RGB")).astype(np.float32)
    alpha = np.array(trabajo.split()[-1])
    angulo = _campo_direccion(rgb.astype(np.uint8))

    # Aplanar sobre negro (no simplemente descartar el alfa) para que el
    # borde silueta/fondo también salga como un borde marcado en Canny,
    # igual que cualquier borde interno -- un solo criterio para los dos casos.
    sobre_negro = Image.new("RGB", trabajo.size, (0, 0, 0))
    sobre_negro.paste(trabajo, mask=trabajo.split()[-1])
    gris_plano = cv2.cvtColor(np.array(sobre_negro), cv2.COLOR_RGB2GRAY)
    bordes = cv2.Canny(gris_plano, 50, 150)
    kernel = np.ones((grosor_trabajo, grosor_trabajo), np.uint8)
    # Banda alrededor de CUALQUIER borde marcado (silueta exterior, letras,
    # líneas de dibujo), acotada a adentro de la silueta -- no se borda
    # sobre el fondo transparente.
    banda = (cv2.dilate(bordes, kernel) > 0) & (alpha > 0)

    lienzo = np.zeros(alpha.shape, dtype=np.float32)
    alto, ancho = alpha.shape
    for y in range(0, alto, paso_px):
        fila_banda = banda[y]
        for x in range(0, ancho, paso_px):
            if not fila_banda[x]:
                continue
            a = float(angulo[y, x])
            dx = largo_px * np.cos(a)
            dy = largo_px * np.sin(a)
            # El "color" acá es directamente la intensidad de la máscara
            # (blanco = más tinta) -- mismo brillo satinado que bordar(),
            # pero como escala de grises en vez de tiñendo el RGB original.
            brillo = 0.6 + 0.4 * abs(np.cos(a - BORDADO_ANGULO_LUZ))
            intensidad = float(np.clip(255 * brillo, 0, 255))
            cv2.line(
                lienzo,
                (int(round(x - dx)), int(round(y - dy))),
                (int(round(x + dx)), int(round(y + dy))),
                intensidad,
                thickness=2,
                lineType=cv2.LINE_AA,
            )

    resultado = Image.fromarray(np.clip(lienzo, 0, 255).astype(np.uint8), mode="L")
    if factor < 1:
        resultado = resultado.resize((original.width, original.height), Image.LANCZOS)

    salida = io.BytesIO()
    resultado.save(salida, format="PNG")
    return salida.getvalue()


# --- DTF UV: vectorizar -> silueta limpia -> propuesta de capas spot ---
# Ver /Users/ricardo/.claude/plans/witty-napping-origami.md, Fase 2.

def vectorizar(imagen_bytes: bytes) -> str:
    """Raster (PNG, con alfa) -> SVG. vtracer preserva la transparencia:
    las zonas totalmente transparentes de entrada no generan paths."""
    # Segunda protección además de la del backend al subir (rotate() con
    # sharp): si por lo que sea llega un archivo con orientación EXIF sin
    # normalizar, vtracer (que no la respeta) traza en otra
    # orientación/proporción que la que se ve en el navegador -- el vector
    # queda "corrido" respecto al diseño real en el editor.
    imagen_bytes = _bytes_png_orientados(imagen_bytes)
    return vtracer.convert_raw_image_to_svg(
        imagen_bytes,
        img_format="png",
        colormode="color",
        mode="spline",
        filter_speckle=4,
        color_precision=6,
        corner_threshold=60,
        length_threshold=4.0,
        max_iterations=10,
        splice_threshold=45,
        path_precision=3,
    )


def rasterizar_silueta(svg_texto: str, ancho_px: int, alto_px: int) -> bytes:
    """SVG -> PNG limpio (sin ruido de compresión/antialiasing del raster
    original) al tamaño de trabajo pedido. Fondo transparente: cairosvg no
    pinta nada donde el SVG no tiene paths."""
    return cairosvg.svg2png(bytestring=svg_texto.encode("utf-8"), output_width=ancho_px, output_height=alto_px)


def proponer_capas(silueta_bytes: bytes, grosor_relieve_px: int, sensibilidad: int) -> bytes:
    """Máscara gris de 8 bits (PNG, un canal) para las capas spot: la
    silueta llena, con un borde de relieve suave de ancho grosor_relieve_px
    (transición gradual del centro hacia afuera, no un corte duro). Se
    reutiliza tal cual como propuesta inicial tanto para blanco como para
    barniz -- el usuario las diverge a mano después en el editor.

    sensibilidad (0-100) controla qué tan permisivo es el umbral sobre el
    canal alfa de la silueta: más alto = capta más píxeles semitransparentes
    del borde como parte de la silueta.
    """
    im = Image.open(io.BytesIO(silueta_bytes)).convert("RGBA")
    alpha = np.array(im.split()[-1]).astype(np.float32)

    sensibilidad = np.clip(sensibilidad, 0, 100)
    umbral = np.clip(255 * (1 - sensibilidad / 100), 5, 250)
    binaria = (alpha > umbral).astype(np.uint8) * 255

    grosor = max(int(grosor_relieve_px), 1)
    # Distancia de cada píxel interior al borde más cercano: 0 justo en el
    # borde, creciendo hacia el centro -- normalizada por grosor_relieve_px
    # da una banda de transición suave de ese ancho, en vez de un corte duro.
    distancia = cv2.distanceTransform(binaria, cv2.DIST_L2, 5)
    banda = np.clip(distancia / grosor, 0, 1)
    mascara = (banda * 255).astype(np.uint8)
    mascara = cv2.GaussianBlur(mascara, (0, 0), sigmaX=max(grosor / 3, 1))
    mascara = np.where(binaria > 0, mascara, 0).astype(np.uint8)

    salida = io.BytesIO()
    Image.fromarray(mascara, mode="L").save(salida, format="PNG")
    return salida.getvalue()


# --- DTF UV: patrón de relieve generado con IA (Gemini) ---
# Complementa (no reemplaza) proponer_capas(): el usuario describe el
# efecto en texto y Gemini genera una imagen -- probado a mano: el modelo
# NO soporta transparencia real (a veces hasta dibuja un cuadriculado falso
# de "transparencia" en vez de dejarlo transparente de verdad), así que se
# le pide explícitamente un fondo magenta sólido y se recorta después por
# color (HSV). Se prefiere este recorte por color a quitar_fondo (rembg)
# para este caso puntual: un patrón sintético sin un sujeto fotográfico
# claro confunde al segmentador (probado a mano, dejaba todo el cuadro
# adentro).
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent"
GEMINI_TIMEOUT_S = 60
# Instrucción fija que se agrega SIEMPRE al prompt del usuario -- magenta
# puro es deliberadamente poco probable como color real de un relieve
# blanco/dorado/plateado, para minimizar falsos recortes sobre el patrón.
GEMINI_INSTRUCCION_FONDO = (
    " The image must be on a solid, perfectly flat, uniform magenta color background "
    "(hex FF00FF), no gradient, no shadow, no checkerboard pattern, no vignette -- "
    "the entire background must be that single flat color so it can be color-keyed out "
    "afterward. Do not use magenta anywhere in the subject itself."
)
def generar_patron_ia(prompt: str) -> bytes:
    """Genera una TEXTURA repetible con Gemini a partir de una instrucción
    de texto -- no reemplaza ninguna máscara directo: es un archivo aparte
    que el editor de relieve (EditorMascara.vue) usa como relleno (canvas
    pattern) sobre las regiones del vector que el usuario ya activó, así
    que el resultado tiene que tener fondo REALMENTE transparente (no un
    plano gris): el hueco es justo lo que genera la variación de relieve al
    aplicarla, y el borde de cada figura la determina el vector, no esto.

    Le pedimos a Gemini un fondo magenta sólido (imposible de confundir con
    un relieve real) para poder recortarlo por color después (HSV, no ML --
    más simple y confiable que rembg para un fondo de un solo color plano
    pedido a propósito). La intensidad (RGB) sale de la luminosidad del
    propio patrón generado (con estiramiento de contraste), NO de un blanco
    plano -- así la textura real (líneas, puntadas, relieve fotográfico que
    dibuja Gemini) se nota como variación real al usarla, no un bloque
    parejo."""
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY no está configurada en el ai-service (.env)")

    resp = requests.post(
        GEMINI_URL.format(modelo=GEMINI_MODEL),
        params={"key": GEMINI_API_KEY},
        json={
            "contents": [{"parts": [{"text": prompt + GEMINI_INSTRUCCION_FONDO}]}],
            "generationConfig": {"responseModalities": ["IMAGE"]},
        },
        timeout=GEMINI_TIMEOUT_S,
    )
    if not resp.ok:
        raise RuntimeError(f"Gemini respondió {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    try:
        partes = data["candidates"][0]["content"]["parts"]
        b64 = next(p["inlineData"]["data"] for p in partes if "inlineData" in p)
    except (KeyError, IndexError, StopIteration):
        raise RuntimeError(f"Gemini no devolvió una imagen: {str(data)[:300]}")

    imagen = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
    rgb_u8 = np.array(imagen)
    hsv = cv2.cvtColor(rgb_u8, cv2.COLOR_RGB2HSV)
    h, s = hsv[..., 0].astype(np.int32), hsv[..., 1].astype(np.int32)
    # OpenCV mide H en 0-179 (mitad de grados): magenta puro (~300-345°) cae
    # en ~150-172.
    es_fondo = (h > 150) & (h < 172) & (s > 60)
    alpha = np.where(es_fondo, 0, 255).astype(np.uint8)
    # Suaviza el borde del recorte (antialiasing real, no un corte duro).
    alpha = cv2.GaussianBlur(alpha, (0, 0), sigmaX=1.0)

    luminosidad = np.array(imagen.convert("L")).astype(np.float32)
    dentro = alpha > 10
    if dentro.any():
        p2, p98 = np.percentile(luminosidad[dentro], [2, 98])
        if p98 > p2:
            luminosidad = np.clip((luminosidad - p2) / (p98 - p2) * 255, 0, 255)
    intensidad = luminosidad.astype(np.uint8)

    salida = np.dstack([intensidad, intensidad, intensidad, alpha])
    resultado = Image.fromarray(salida, mode="RGBA")
    buf = io.BytesIO()
    resultado.save(buf, format="PNG")
    return buf.getvalue()


# Nombres de los 4 canales spot extra en el TIFF -- confirmados byte a byte
# contra un archivo de producción real del usuario (spot/3080.tif, Fase 0
# del plan): "W1"/"W1 copy" para blanco (Spot1/Spot2), "V"/"V copy" para
# barniz (Spot3/Spot4) -- la misma máscara duplicada dos veces por tinta,
# igual que en exportarDtfUv.js (PDF).
NOMBRES_CANALES_TIFF = ["W1", "W1 copy", "V", "V copy"]


def _bloque_photoshop_alpha_channel_names(nombres):
    """Arma el resource block de Photoshop (8BIM, resource id 1006 "Alpha
    Channel Names") con los nombres de los canales extra -- el TIFF no tiene
    un tag estándar para esto (a diferencia de InkNames en modo Separated
    normal); Photoshop (y el RIP real del usuario) los lee de acá. Mismo
    formato encontrado al inspeccionar 3080.tif a mano con tiffdump."""
    contenido = b"".join(bytes([len(n)]) + n.encode("latin1") for n in nombres)
    if len(contenido) % 2 != 0:
        contenido += b"\x00"
    bloque = b"8BIM" + struct.pack(">H", 1006) + b"\x00\x00" + struct.pack(">I", len(contenido)) + contenido
    if len(bloque) % 2 != 0:
        bloque += b"\x00"
    return bloque


def exportar_tiff_spot(mascara_blanco_bytes: bytes, mascara_barniz_bytes: bytes, ancho_mm: float, alto_mm: float) -> bytes:
    """TIFF Photometric=Separated de 8 canales -- CMYK en blanco (el diseño
    DTF UV no lleva proceso de color, solo blanco+barniz) + Spot1/Spot2
    ("W1"/"W1 copy", desde mascara_blanco) + Spot3/Spot4 ("V"/"V copy",
    desde mascara_barniz). Misma estructura que un archivo de producción
    real del usuario, validada en scripts/spike-spot-tiff.py."""
    blanco = Image.open(io.BytesIO(mascara_blanco_bytes)).convert("L")
    barniz = Image.open(io.BytesIO(mascara_barniz_bytes)).convert("L")
    if barniz.size != blanco.size:
        barniz = barniz.resize(blanco.size, Image.LANCZOS)
    ancho_px, alto_px = blanco.size

    blanco_arr = np.array(blanco)
    barniz_arr = np.array(barniz)
    cmyk = np.zeros((4, alto_px, ancho_px), dtype=np.uint8)
    spots = np.stack([blanco_arr, blanco_arr, barniz_arr, barniz_arr], axis=0)
    datos = np.concatenate([cmyk, spots], axis=0)
    datos = np.moveaxis(datos, 0, -1)  # tifffile: (alto, ancho, canales), planarconfig=contig

    resource_ps = _bloque_photoshop_alpha_channel_names(NOMBRES_CANALES_TIFF)
    # DPI real del archivo: píxeles del diseño sobre su tamaño físico -- no
    # un valor fijo (el spike usaba uno de prueba), para que el RIP lea el
    # tamaño de impresión correcto sin tener que confiar en un dato aparte.
    dpi = ancho_px / (float(ancho_mm) / 25.4) if ancho_mm else 300.0

    buf = io.BytesIO()
    tifffile.imwrite(
        buf,
        datos,
        photometric="separated",
        extrasamples=[0, 0, 0, 0],
        resolution=(dpi, dpi),
        resolutionunit="inch",
        extratags=[(34377, "B", len(resource_ps), resource_ps, False)],
    )
    return buf.getvalue()
