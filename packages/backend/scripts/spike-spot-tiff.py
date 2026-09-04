#!/usr/bin/env python3
"""
Spike aislado (extensión de la Fase 0 del plan de DTF UV, ver
/Users/ricardo/.claude/plans/witty-napping-origami.md): prueba que se puede
escribir un TIFF "Separated" multicanal (CMYK + N canales spot con nombre
real) con la MISMA estructura que un archivo de producción real
(spot/3080.tif, inspeccionado a mano con tiffdump: Photometric=Separated,
SamplesPerPixel=8, BitsPerSample=8x8, ExtraSamples=4 "unspecified", y los
nombres de los 4 canales extra ("W1", "W1 copy", "V", "V copy") guardados en
el bloque de recursos de Photoshop (tag 34377, resource id 1006 "Alpha
Channel Names") -- no en un tag TIFF estándar como InkNames.

Corre con el venv del ai-service (tiene tifffile como dependencia
transitiva de scikit-image):

  cd packages/ai-service && source venv/bin/activate
  python3 ../backend/scripts/spike-spot-tiff.py [ruta-salida.tif]

No toca la app -- desechable, solo para validar la técnica antes de
construirla en el ai-service real (Fase 5).
"""
import struct
import sys

import numpy as np
import tifffile

RUTA_SALIDA = sys.argv[1] if len(sys.argv) > 1 else "/tmp/spike-spot.tif"
ANCHO, ALTO = 400, 300
NOMBRES_CANALES_EXTRA = ["W1", "W1 copy", "V", "V copy"]


def bloque_photoshop_alpha_channel_names(nombres):
    """Arma el resource block de Photoshop (8BIM) con resource id 1006
    ("Alpha Channel Names"): una lista de Pascal strings, una por canal
    extra -- el mismo formato que se encontró al parsear 3080.tif a mano."""
    contenido = b"".join(bytes([len(n)]) + n.encode("latin1") for n in nombres)
    if len(contenido) % 2 != 0:
        contenido += b"\x00"
    bloque = b"8BIM" + struct.pack(">H", 1006) + b"\x00\x00" + struct.pack(">I", len(contenido)) + contenido
    if len(bloque) % 2 != 0:
        bloque += b"\x00"
    return bloque


def main():
    # 4 canales CMYK (en blanco = todo 0, sin tinta de proceso) + 4 canales
    # spot con un patrón de prueba distinto cada uno, para poder distinguirlos
    # al releer el archivo.
    cmyk = np.zeros((4, ALTO, ANCHO), dtype=np.uint8)
    spots = np.zeros((4, ALTO, ANCHO), dtype=np.uint8)
    for i in range(4):
        # Franja diagonal de intensidad creciente, distinta por canal, para
        # poder confirmar visualmente cuál-es-cuál al inspeccionar cada plano.
        y, x = np.mgrid[0:ALTO, 0:ANCHO]
        spots[i] = np.clip(((x + y * (i + 1)) % 256), 0, 255).astype(np.uint8)

    datos = np.concatenate([cmyk, spots], axis=0)  # (8, alto, ancho)
    datos = np.moveaxis(datos, 0, -1)  # tifffile espera (alto, ancho, canales) en modo "planarconfig=contig"

    resource_ps = bloque_photoshop_alpha_channel_names(NOMBRES_CANALES_EXTRA)

    tifffile.imwrite(
        RUTA_SALIDA,
        datos,
        photometric="separated",
        extrasamples=[0, 0, 0, 0],  # "unspecified", igual que el archivo real
        resolution=(185.293, 185.293),
        resolutionunit="inch",
        extratags=[
            (34377, "B", len(resource_ps), resource_ps, False),  # Photoshop Image Resources
        ],
    )
    print(f"OK: {RUTA_SALIDA}")


if __name__ == "__main__":
    main()
