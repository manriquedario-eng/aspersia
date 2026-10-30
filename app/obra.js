// Reglas que unen el diseño de una obra con el cálculo, el plano y el presupuesto.
// Es el único lugar donde se decide qué aspersor es cada uno, qué entra al cálculo de cada sector
// y cómo salen las distancias del plano. Lo usan la pantalla, el plano, la vista 3D, el presupuesto y las pruebas.
// Usa RIEGO (cálculo), PRESUPUESTO (materiales y totales) y GEOMETRIA (plano).

(function (global) {
  const R = () => global.RIEGO;
  const r1 = v => Math.round(v * 10) / 10;

  // Tipos de boquilla en los que el arco se escribe libre (en las PGP, el arco solo cuenta para la superficie y el plano).
  const esAjustable = a => a.tipo === R().TIPO_AJUSTABLE;
  const esMP = a => a.tipo === R().TIPO_MP;
  const arcoLibre = a => esAjustable(a) || esMP(a) || a.tipo === 'Turbina PGP Ultra';

  // Id del aspersor para el cálculo a partir de lo que se eligió en pantalla (tipo, boquilla y arco).
  function idEmisor(a) {
    if (esAjustable(a)) return `pro-${a.boquilla}@${a.arco}`;
    if (esMP(a)) return `mp-${a.boquilla}@${a.arco}`;
    const e = R().emisores().find(e => e.tipo === a.tipo && e.boquilla === a.boquilla && (e.arco == null || e.arco === Number(a.arco)));
    return e && e.id;
  }

  // Lo que necesita RIEGO.calcularSector para un sector de la obra.
  const paraCalcular = obra => s => ({
    fuente: obra.fuente.tipo === 'bomba'
      ? { tipo: 'bomba', linea: obra.fuente.linea, modelo: obra.fuente.modelo, aspiracion: obra.fuente.aspiracion }
      : { tipo: 'presion', bar: obra.fuente.bar },
    alimentacion: s.alimentacion, valvula: s.valvula, lateral: s.lateral, manguera: s.manguera || null,
    aspersores: s.aspersores.map(a => ({ emisor: idEmisor(a), regulador: a.regulador || null, distancia: a.distancia, altura: a.altura, manguera: a.manguera || 0 })),
    accesorios: obra.accesorios,
  });

  function calcular(obra, s) {
    try {
      const d = paraCalcular(obra)(s);
      return { r: R().calcularSector(d), rec: R().recomendarDiametro(d) };
    } catch (err) { return { error: err.message }; }
  }

  // Con "calcular los caños con las distancias del plano", las distancias entre aspersores y el largo hasta
  // cada válvula salen de las posiciones. Se llama antes de cualquier cálculo, así todo usa los mismos metros.
  function sincronizarDistancias(obra) {
    if (!obra.plano || !obra.plano.distanciasDesdePlano) return;
    global.GEOMETRIA.ubicarSinPosicion(obra.plano, obra.sectores);
    const f = obra.plano.fuente;
    for (const s of obra.sectores) {
      global.GEOMETRIA.distanciasDesdePlano(s.valvulaPos, s.aspersores).forEach((d, i) => s.aspersores[i].distancia = d);
      s.alimentacion.largo = r1(Math.hypot(s.valvulaPos.x - f.x, s.valvulaPos.y - f.y));
    }
  }

  function presupuesto(obra, precios) {
    if (!obra.presupuesto.congelado) sincronizarDistancias(obra);
    return global.PRESUPUESTO.armarPresupuesto(obra, precios, paraCalcular(obra));
  }

  // Ángulo de salida del chorro, para la vista 3D. Pro fijas y ajustables: el del catálogo (págs. 74 a 78).
  // PGP Ultra: 25° la estándar y 13° la de ángulo bajo (pág. 22). MP Rotator no lo publica: se usan unos 15°.
  function trayectoria(e) {
    const H = global.HUNTER;
    if (e.tipo === 'Boquilla Pro fija' || e.tipo === R().TIPO_AJUSTABLE) {
      const b = [...H.proFijas.boquillas, ...H.proAjustables.boquillas].find(x => x.modelo === e.boquilla);
      return b ? b.trayectoria : 15;
    }
    if (e.tipo.startsWith('Turbina PGP Ultra')) return /ángulo bajo/i.test(e.nombre) ? 13 : 25;
    if (e.tipo === 'MP Rotator de franja') return 8;
    return 15;
  }

  // Aspersores de la obra con lo que hace falta para el plano y el 3D: posición, giro, alcance real
  // (con la presión que le llega a cada uno), arco, forma (abanico o franja) y trayectoria.
  function aspersoresDelPlano(obra) {
    const lista = [];
    obra.sectores.forEach((s, k) => {
      const c = calcular(obra, s);
      s.aspersores.forEach((a, i) => {
        let e;
        try { e = R().emisor(idEmisor(a)); } catch { return; }      // aspersor con un dato inválido: no se dibuja
        const radio = c.r ? c.r.aspersores[i].radio : e.radios[Math.floor(e.radios.length / 2)];
        const franja = e.tipo === 'MP Rotator de franja' ? (/LCS/.test(e.boquilla) ? 'LCS' : /RCS/.test(e.boquilla) ? 'RCS' : 'SS') : null;
        const arco = e.arco ?? a.arco ?? 360;
        lista.push({ s: k, i, x: a.x, y: a.y, giro: a.giro || 0, radio, arco, franja, ancho: 1.5, nombre: e.nombre, trayectoria: trayectoria(e) });
      });
    });
    return lista;
  }

  global.OBRA = { esAjustable, esMP, arcoLibre, idEmisor, paraCalcular, calcular, sincronizarDistancias, presupuesto, trayectoria, aspersoresDelPlano };
})(typeof window !== 'undefined' ? window : globalThis);
