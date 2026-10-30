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

  // Arco que escribe el usuario (Darío: cualquiera de 1° a 360°, en todas las toberas).
  // Las Pro fijas vienen de fábrica en pocos arcos: si se pide otro, se cambia por la ajustable del mismo tamaño,
  // que se regula a cualquier arco. Las MP y las MPR tienen el rango que da Hunter: fuera de él, error.
  // Devuelve un aviso para mostrar (o null) y lanza un error si el arco no se puede usar.
  const AJUSTABLE_DE = { 5: '6A', 8: '8A-HE', 10: '10A-HE', 12: '12A-HE', 15: '15A-HE', 17: '17A-HE' };
  const arcosDeFabrica = a => R().emisores().filter(e => e.tipo === a.tipo && e.boquilla === a.boquilla && e.arco != null).map(e => e.arco);
  function ponerArco(a, valor) {
    const arco = Math.round(Number(valor));
    if (!(arco >= 1 && arco <= 360)) throw new Error('El arco va de 1° a 360°.');
    if (a.tipo === 'MP Rotator de franja') throw new Error('Las MP de franja no llevan arco: riegan una franja.');
    if (esMP(a)) R().emisor(`mp-${a.boquilla}@${arco}`);   // lanza el error de Hunter si el arco no va
    if (!arcoLibre(a)) {
      const trae = arcosDeFabrica(a);
      if (!trae.includes(arco)) {
        const aj = a.tipo === 'Boquilla Pro fija' && AJUSTABLE_DE[a.boquilla];
        if (!aj) throw new Error(`La ${a.boquilla} viene solo en ${trae.join(', ')}°.`);
        const antes = a.boquilla;
        Object.assign(a, { tipo: R().TIPO_AJUSTABLE, boquilla: aj, arco });
        return `La boquilla fija ${antes} no viene en ${arco}°: se cambió por la ajustable ${aj}, que se regula a cualquier arco.`;
      }
    }
    a.arco = arco;
    return null;
  }

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

  // Un sector con el ramal dibujado en el plano: los aspersores quedan en el orden en que los pasa el caño,
  // la distancia de cada uno es el tramo de caño desde la conexión anterior y la manguera, la recta hasta el caño.
  const MANGUERA_MINIMA = 0.5;   // aunque el aspersor esté pegado al caño, siempre lleva un poco de manguera
  const tieneRamal = s => !!(s.ramal && s.ramal.length && s.valvulaPos);
  // Los que todavía no están ubicados en el plano quedan al final, con lo que se escribió a mano.
  function aplicarRamal(s) {
    const G = global.GEOMETRIA;
    const ubicados = s.aspersores.filter(a => a.x != null && a.y != null);
    const con = G.conexionesAlRamal(s.valvulaPos, s.ramal, ubicados);
    const ordenados = con.map(c => ubicados[c.i]);
    con.forEach((c, k) => {
      ordenados[k].distancia = r1(c.tramo);
      ordenados[k].manguera = Math.max(MANGUERA_MINIMA, r1(c.manguera));
    });
    s.aspersores.splice(0, s.aspersores.length, ...ordenados, ...G.sinUbicar(s));   // mismo arreglo: lo que lo tenga a mano lo sigue viendo
  }
  const largoRamal = s => tieneRamal(s) ? global.GEOMETRIA.largoDeLinea([s.valvulaPos, ...s.ramal]) : null;
  const codosRamal = s => tieneRamal(s) ? s.ramal.length - 1 : 0;

  // Con "calcular los caños con las distancias del plano", las distancias entre aspersores y el largo hasta
  // cada válvula salen de las posiciones. Un sector con ramal dibujado sale siempre del plano (orden, tramos y mangueras).
  // Se llama antes de cualquier cálculo, así todo usa los mismos metros.
  function sincronizarDistancias(obra) {
    if (!obra.plano) return;
    const desdePlano = obra.plano.distanciasDesdePlano;
    if (!desdePlano && !obra.sectores.some(tieneRamal)) return;
    global.GEOMETRIA.ubicarSinPosicion(obra.plano, obra.sectores);
    const f = obra.plano.fuente;
    for (const s of obra.sectores) {
      if (tieneRamal(s)) aplicarRamal(s);
      else if (desdePlano) global.GEOMETRIA.distanciasDesdePlano(s.valvulaPos, s.aspersores).forEach((d, i) => { if (d != null) s.aspersores[i].distancia = d; });
      if (desdePlano) s.alimentacion.largo = r1(Math.hypot(s.valvulaPos.x - f.x, s.valvulaPos.y - f.y));
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
        if (a.x == null || a.y == null) return;                       // sin ubicar todavía: no se dibuja
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

  // Superficie de las zonas a regar dibujadas en el plano (m²), o null si no hay ninguna.
  const superficieZonas = obra => obra.plano?.zonas?.length ? obra.plano.zonas.reduce((t, z) => t + global.GEOMETRIA.areaPoligono(z), 0) : null;

  global.OBRA = { esAjustable, esMP, arcoLibre, ponerArco, superficieZonas, tieneRamal, largoRamal, codosRamal, MANGUERA_MINIMA, idEmisor, paraCalcular, calcular, sincronizarDistancias, presupuesto, trayectoria, aspersoresDelPlano };
})(typeof window !== 'undefined' ? window : globalThis);
