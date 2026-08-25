import { describe, it, expect } from "vitest";
import { empacar } from "../src/index.js";

describe("empacar", () => {
  it("respeta el ancho fijo del lienzo", () => {
    const { colocaciones } = empacar({
      canvasAncho: 280,
      tipo: "dtf",
      margen: 0,
      items: [{ id: 1, anchoMM: 100, altoMM: 60, copias: 6 }],
    });
    for (const c of colocaciones) {
      expect(c.x + c.ancho).toBeLessThanOrEqual(280 + 1e-6);
    }
    expect(colocaciones).toHaveLength(6);
  });

  it("expande por copias generando un rectángulo por copia", () => {
    const { colocaciones } = empacar({
      canvasAncho: 580,
      tipo: "dtf",
      margen: 0,
      items: [
        { id: 1, anchoMM: 100, altoMM: 150, copias: 3 },
        { id: 2, anchoMM: 50, altoMM: 50, copias: 2 },
      ],
    });
    expect(colocaciones.filter((c) => c.id === 1)).toHaveLength(3);
    expect(colocaciones.filter((c) => c.id === 2)).toHaveLength(2);
  });

  it("en DTF permite rotar 90° cuando conviene", () => {
    // Pieza más alta que ancha, en un lienzo angosto: solo entra rotada.
    const { colocaciones } = empacar({
      canvasAncho: 100,
      tipo: "dtf",
      margen: 0,
      items: [{ id: 1, anchoMM: 150, altoMM: 80, copias: 1 }],
    });
    expect(colocaciones[0].rotacion).toBe(90);
    expect(colocaciones[0].ancho).toBe(80);
    expect(colocaciones[0].alto).toBe(150);
  });

  it("en sublimación nunca rota 90/270 aunque convenga", () => {
    expect(() =>
      empacar({
        canvasAncho: 100,
        tipo: "sublimacion",
        margen: 0,
        items: [{ id: 1, anchoMM: 150, altoMM: 80, copias: 1 }],
      })
    ).toThrow(/no entra/);

    const { colocaciones } = empacar({
      canvasAncho: 200,
      tipo: "sublimacion",
      margen: 0,
      items: [{ id: 1, anchoMM: 150, altoMM: 80, copias: 4 }],
    });
    for (const c of colocaciones) {
      expect(c.rotacion).toBe(0);
      expect(c.ancho).toBe(150);
      expect(c.alto).toBe(80);
    }
  });

  it("aplica el margen como padding y lo descuenta al reportar la pieza real", () => {
    const { colocaciones } = empacar({
      canvasAncho: 220,
      tipo: "dtf",
      margen: 10,
      items: [{ id: 1, anchoMM: 100, altoMM: 100, copias: 2 }],
    });
    const [a, b] = colocaciones.sort((p, q) => p.x - q.x);
    expect(a.ancho).toBe(100);
    expect(a.alto).toBe(100);
    // Separación entre piezas debe ser al menos el margen completo (medio margen de cada lado).
    expect(b.x - (a.x + a.ancho)).toBeCloseTo(10, 5);
  });

  it("recorta el alto final a la Y máxima realmente alcanzada", () => {
    const { altoFinalUsado } = empacar({
      canvasAncho: 200,
      tipo: "dtf",
      margen: 0,
      items: [{ id: 1, anchoMM: 100, altoMM: 100, copias: 2 }],
    });
    // 2 piezas de 100x100 en un lienzo de 200 de ancho entran en una sola fila.
    expect(altoFinalUsado).toBe(100);
  });

  it("lanza error si una pieza no entra en ninguna orientación permitida", () => {
    expect(() =>
      empacar({
        canvasAncho: 50,
        tipo: "dtf",
        margen: 0,
        items: [{ id: 1, anchoMM: 100, altoMM: 100, copias: 1 }],
      })
    ).toThrow();
  });
});
