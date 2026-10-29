// Cálculo hidráulico de un sector de riego.
// Usa los datos de datos/hunter-2026.js (window.HUNTER) y datos/czerweny.js (window.CZERWENY).
// Funciona igual en el navegador y en Node (las pruebas lo cargan con globalThis).
//
// Criterios:
// - El caudal de cada aspersor sale de la tabla del catálogo según la presión que le llega
//   (interpolación lineal entre presiones de la tabla, nunca fuera de ella).
// - Donde el catálogo da m³/h y l/min que no coinciden, se usa el mayor (del lado seguro).
// - Pérdida en caños: Hazen-Williams, con el mismo C que usan las tablas de Hunter.
// - Unidades internas: bar, l/min, metros. 1 bar = 10,2 m de columna de agua.

(function (global) {
  const MCA_POR_BAR = 10.2;
  const VELOCIDAD_MAX = 1.5;     // m/s, la que marcan como límite las tablas de Hunter
  const VARIACION_MAX = 20;      // % de diferencia de presión admitida dentro del sector

  // Caños: diámetro interior por tamaño nominal. Hunter, págs. 215, 216, 219 y 220.
  const CANOS = {
    'pead-pn6':  { nombre: 'PEAD PN6', detalle: 'Polietileno PEAD PN6 (SDR 17,6)', C: 140, pagina: 219,
      di: { 25: 21.4, 32: 28.4, 40: 35.4, 50: 44.2, 63: 55.8, 75: 66.4, 90: 79.8, 110: 97.4 } },
    'pead-pn10': { nombre: 'PEAD PN10', detalle: 'Polietileno PEAD PN10 (SDR 11)', C: 140, pagina: 220,
      di: { 25: 20.4, 32: 26.2, 40: 32.6, 50: 40.8, 63: 51.4, 75: 61.4, 90: 73.6, 110: 90.0 } },
    'pvc-c4':    { nombre: 'PVC clase 4', detalle: 'PVC clase 4 (10 bar)', C: 150, pagina: 215,
      di: { 25: 22.0, 32: 28.4, 40: 36.2, 50: 45.2, 63: 57.0, 75: 67.8, 90: 81.4, 110: 99.4 } },
    'pvc-c5':    { nombre: 'PVC clase 5', detalle: 'PVC clase 5 (16 bar)', C: 150, pagina: 216,
      di: { 25: 21.2, 32: 27.2, 40: 34.0, 50: 42.6, 63: 53.6, 75: 63.8, 90: 76.6, 110: 93.6 } },
  };

  // Interpolación lineal. "fuera" = -1 si x queda debajo de la tabla, 1 si queda arriba, 0 si está dentro.
  // Fuera de la tabla devuelve el valor del extremo (no extrapola).
  function interpolar(xs, ys, x) {
    const n = xs.length;
    if (x <= xs[0]) return { valor: ys[0], fuera: x < xs[0] - 1e-9 ? -1 : 0 };
    if (x >= xs[n - 1]) return { valor: ys[n - 1], fuera: x > xs[n - 1] + 1e-9 ? 1 : 0 };
    let i = 1;
    while (xs[i] < x) i++;
    const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
    return { valor: ys[i - 1] + t * (ys[i] - ys[i - 1]), fuera: 0 };
  }

  // Pérdida por fricción en bar (Hazen-Williams). caudal en l/min, largo en m, di en mm.
  function perdidaCano(caudalLmin, largo, di, C) {
    if (caudalLmin <= 0 || largo <= 0) return 0;
    const q = caudalLmin / 60000;                       // m³/s
    const d = di / 1000;                                 // m
    const metros = 10.674 * largo * Math.pow(q, 1.852) / (Math.pow(C, 1.852) * Math.pow(d, 4.871));
    return metros / MCA_POR_BAR;
  }

  function velocidad(caudalLmin, di) {
    const q = caudalLmin / 60000;
    const area = Math.PI * Math.pow(di / 1000, 2) / 4;
    return q / area;
  }

  function cano(material, nominal) {
    const tipo = CANOS[material];
    if (!tipo) throw new Error('Material de caño desconocido: ' + material);
    const di = tipo.di[nominal];
    if (!di) throw new Error(`No hay caño ${tipo.nombre} de ${nominal} mm`);
    return { material, nominal, di, C: tipo.C, nombre: `${tipo.nombre} ${nominal} mm` };
  }

  // ---------- Catálogo de emisores (aspersores con su boquilla y su arco) ----------

  // Caudal en l/min de una fila [radio, m³/h, l/min]: el mayor de las dos columnas.
  const caudalFila = f => Math.max(f[2], f[1] * 1000 / 60);

  function armarEmisores(H) {
    const lista = [];
    const agregar = (e) => lista.push(e);
    // tipo = cómo se agrupan en la pantalla
    const conSectores = (grupo, familia, prefijo, cuerpo, tipo) => {
      for (const b of grupo.boquillas)
        for (const [arco, filas] of Object.entries(b.sectores))
          agregar({
            id: `${prefijo}-${b.modelo}-${arco}`, familia, cuerpo, tipo,
            nombre: `${b.modelo} ${arco}°`, boquilla: b.modelo, arco: Number(arco),
            pagina: b.pagina || grupo.pagina, presiones: grupo.presiones,
            radios: filas.map(f => f[0]), caudales: filas.map(caudalFila),
          });
    };
    conSectores(H.proFijas, 'difusor', 'pro', 'Pro-Spray', 'Boquilla Pro fija');
    conSectores(H.proAjustables, 'difusor', 'pro', 'Pro-Spray', TIPO_AJUSTABLE);
    conSectores(H.mpRotator, 'mp', 'mp', 'Pro-Spray', 'MP Rotator');
    for (const b of H.mpRotator.franjas.boquillas)
      agregar({
        id: `mp-${b.modelo}`, familia: 'mp', cuerpo: 'Pro-Spray', tipo: 'MP Rotator de franja', nombre: `${b.modelo} (${b.nombre.toLowerCase()})`, boquilla: b.modelo, arco: null,
        pagina: H.mpRotator.franjas.pagina, presiones: H.mpRotator.presiones,
        radios: b.filas.map(f => f[0][1]), caudales: b.filas.map(caudalFila),
      });
    for (const b of H.pgpUltra.boquillas)
      agregar({
        id: `pgp-${b.modelo}`, familia: 'turbina', cuerpo: 'PGP Ultra', tipo: 'Turbina PGP Ultra', nombre: `${b.modelo} (${b.serie.toLowerCase()})`, boquilla: b.modelo, arco: null,
        pagina: b.pagina, presiones: H.pgpUltra.presiones,
        radios: b.filas.map(f => f[0]), caudales: b.filas.map(caudalFila),
      });
    conSectores(H.pgpUltra.mpr, 'turbina', 'pgp', 'PGP Ultra', 'Turbina PGP Ultra con boquilla MPR');
    return lista;
  }

  let cacheEmisores = null;
  function emisores() {
    if (!cacheEmisores) cacheEmisores = armarEmisores(global.HUNTER);
    return cacheEmisores;
  }

  // Boquillas de arco ajustable: admiten cualquier arco de 1° a 360°.
  // El id es "pro-8A-HE@120". Para un arco que no está en la tabla, caudal y alcance se interpolan
  // entre los dos arcos más cercanos del catálogo; debajo del arco más chico, el caudal es proporcional al arco.
  const TIPO_AJUSTABLE = 'Boquilla Pro ajustable';
  function emisorAjustable(boquilla, arco) {
    const base = emisores().filter(e => e.tipo === TIPO_AJUSTABLE && e.boquilla === boquilla).sort((a, b) => a.arco - b.arco);
    if (!base.length) throw new Error('Boquilla ajustable desconocida: ' + boquilla);
    if (!(arco >= 1 && arco <= 360)) throw new Error(`El arco de la ${boquilla} tiene que estar entre 1° y 360°`);
    const exacta = base.find(e => e.arco === arco);
    const porPresion = (campo, i) => {
      if (exacta) return exacta[campo][i];
      if (arco < base[0].arco) return campo === 'caudales' ? base[0][campo][i] * arco / base[0].arco : base[0][campo][i];
      return interpolar(base.map(e => e.arco), base.map(e => e[campo][i]), arco).valor;
    };
    const ref = base[0];
    return {
      ...ref, id: `pro-${boquilla}@${arco}`, arco, nombre: `${boquilla} ${arco}°`,
      arcoDeTabla: !!exacta,
      radios: ref.presiones.map((_, i) => porPresion('radios', i)),
      caudales: ref.presiones.map((_, i) => porPresion('caudales', i)),
    };
  }

  function emisor(id) {
    const ajustable = /^pro-(.+)@(\d+(?:\.\d+)?)$/.exec(id);
    if (ajustable) return emisorAjustable(ajustable[1], Number(ajustable[2]));
    const e = emisores().find(x => x.id === id);
    if (!e) throw new Error('Aspersor desconocido: ' + id);
    return e;
  }

  // Presión a la que regulan los cuerpos Pro-Spray (pág. 67, 68 y 70).
  const REGULACION = { PRS30: 2.1, PRS40: 2.8 };

  // ---------- Bombas ----------

  function bomba(linea, modelo) {
    const L = global.CZERWENY.lineas.find(x => x.linea === linea);
    const m = L && L.modelos.find(x => x.modelo === modelo);
    if (!m) throw new Error(`Bomba desconocida: ${linea} ${modelo}`);
    const caudales = [], alturas = [];
    L.caudales.forEach((q, i) => { if (m.alturas[i] != null) { caudales.push(q); alturas.push(m.alturas[i]); } });
    return { linea, modelo, hp: m.hp, tension: m.tension, caudales, alturas, aproximada: L.origen === 'curva', duda: m.duda };
  }

  // ---------- Cálculo del sector ----------

  // sector = {
  //   fuente: { tipo: 'presion', bar } | { tipo: 'bomba', linea, modelo, aspiracion (m que la bomba sube el agua al aspirar) },
  //   alimentacion: { material, nominal, largo, desnivel },   // de la fuente a la válvula; desnivel en m (+ si la válvula está más alta)
  //   valvula: true | false,                                    // electroválvula PGV de 1"
  //   lateral: { material, nominal },                           // caño del sector, después de la válvula
  //   aspersores: [{ emisor, regulador: null | 'PRS30' | 'PRS40', distancia, altura }],
  //       distancia: metros de caño desde el punto anterior (la válvula o el aspersor anterior)
  //       altura: metros respecto de la válvula (+ más alto)
  //   accesorios: 10,                                           // % que se suma a la fricción por codos y tes
  // }
  function calcularSector(sector) {
    const avisos = [];
    const acc = 1 + (sector.accesorios ?? 10) / 100;
    const alim = sector.alimentacion && sector.alimentacion.largo > 0
      ? { ...cano(sector.alimentacion.material, sector.alimentacion.nominal), largo: sector.alimentacion.largo, desnivel: sector.alimentacion.desnivel || 0 }
      : null;
    const lat = cano(sector.lateral.material, sector.lateral.nominal);
    const asps = sector.aspersores.map((a, i) => ({
      ...a, n: i + 1, e: emisor(a.emisor),
      reg: a.regulador ? REGULACION[a.regulador] : null,
      distancia: a.distancia || 0, altura: a.altura || 0,
    }));
    if (!asps.length) throw new Error('El sector no tiene aspersores');
    const pump = sector.fuente.tipo === 'bomba' ? bomba(sector.fuente.linea, sector.fuente.modelo) : null;
    const pgv = global.HUNTER.pgv1;

    // Arranca con el caudal del medio de la tabla y va corrigiendo hasta que no cambia.
    let q = asps.map(a => a.e.caudales[Math.floor(a.e.caudales.length / 2)]);
    let estado, iter = 0, convergio = false;
    for (; iter < 500; iter++) {
      estado = recorrer(q);
      const nuevo = estado.asp.map(a => a.caudal);
      const cambio = Math.max(...nuevo.map((v, i) => Math.abs(v - q[i])));
      q = q.map((v, i) => 0.5 * v + 0.5 * nuevo[i]);
      if (cambio < 1e-4) { convergio = true; break; }
    }
    if (!convergio) avisos.push({ nivel: 'error', texto: 'El cálculo no llegó a un resultado estable. Revisá los datos.' });

    // Un recorrido: con los caudales supuestos calcula presiones y, con ellas, los caudales nuevos.
    function recorrer(caudales) {
      const total = caudales.reduce((s, v) => s + v, 0);
      let pFuente, alturaBomba = null;
      if (pump) {
        alturaBomba = interpolar(pump.caudales, pump.alturas, total);
        pFuente = (alturaBomba.valor - (sector.fuente.aspiracion || 0)) / MCA_POR_BAR;
      } else pFuente = sector.fuente.bar;

      const perdAlim = alim ? perdidaCano(total, alim.largo, alim.di, alim.C) * acc : 0;
      const pValvula = pFuente - perdAlim - (alim ? alim.desnivel / MCA_POR_BAR : 0);
      const perdValv = sector.valvula ? interpolar(pgv.perdida.map(f => f[0] * 1000 / 60), pgv.perdida.map(f => f[1]), total) : { valor: 0, fuera: 0 };
      let p = pValvula - perdValv.valor;
      const pSalidaValvula = p;

      const tramos = [], asp = [];
      let alturaAnterior = 0;
      for (let i = 0; i < asps.length; i++) {
        const a = asps[i];
        const qTramo = caudales.slice(i).reduce((s, v) => s + v, 0);
        const friccion = perdidaCano(qTramo, a.distancia, lat.di, lat.C) * acc;
        p -= friccion + (a.altura - alturaAnterior) / MCA_POR_BAR;
        alturaAnterior = a.altura;
        tramos.push({ hasta: a.n, largo: a.distancia, caudal: qTramo, perdida: friccion, velocidad: velocidad(qTramo, lat.di) });
        const pBoquilla = a.reg != null ? Math.min(p, a.reg) : p;
        const c = interpolar(a.e.presiones, a.e.caudales, pBoquilla);
        const r = interpolar(a.e.presiones, a.e.radios, pBoquilla);
        asp.push({ n: a.n, emisor: a.e, regulador: a.regulador || null, presionEntrada: p, presionBoquilla: pBoquilla,
          caudal: c.valor, radio: r.valor, fuera: c.fuera });
      }
      return { total, pFuente, alturaBomba, perdAlim, pValvula, perdValv, pSalidaValvula, tramos, asp };
    }

    const r = estado;
    const presiones = r.asp.map(a => a.presionBoquilla);
    const pMax = Math.max(...presiones), pMin = Math.min(...presiones);
    const variacion = pMax > 0 ? (pMax - pMin) / pMax * 100 : 0;

    // ---------- Avisos ----------
    if (pump) {
      if (r.alturaBomba.fuera > 0) avisos.push({ nivel: 'error', texto: `La bomba ${pump.modelo} no llega a ${fmt(r.total, 1)} l/min: su curva termina en ${fmt(pump.caudales.at(-1), 0)} l/min.` });
      if (r.alturaBomba.fuera < 0) avisos.push({ nivel: 'info', texto: `El caudal queda por debajo del primer punto de la curva de la bomba (${fmt(pump.caudales[0], 0)} l/min); se tomó la altura de ese punto.` });
      if (pump.aproximada) avisos.push({ nivel: 'info', texto: `La curva de la ${pump.modelo} se leyó del gráfico de la ficha: es aproximada.` });
      if (pump.duda) avisos.push({ nivel: 'aviso', texto: `Ficha de la ${pump.modelo}: ${pump.duda}` });
    }
    if (r.pFuente <= 0) avisos.push({ nivel: 'error', texto: 'No hay presión en la fuente con ese caudal.' });
    if (sector.valvula && r.perdValv.fuera > 0) avisos.push({ nivel: 'error', texto: `El caudal supera los 150 l/min que admite la válvula PGV de 1".` });
    // Avisos por aspersor, agrupados cuando varios tienen el mismo problema.
    const grupos = new Map();
    const anotar = (clave, nivel, a, armar) => {
      if (!grupos.has(clave)) grupos.set(clave, { nivel, lista: [], armar });
      grupos.get(clave).lista.push(a);
    };
    for (const a of r.asp) {
      if (a.fuera < 0) anotar('bajo' + a.emisor.id, 'error', a, (l, p) =>
        `${p}: ${l.length > 1 ? 'les' : 'le'} llegan ${rango(l, 'presionBoquilla')} bar, menos que el mínimo de la tabla de ${a.emisor.nombre} (${fmt(a.emisor.presiones[0], 1)} bar). No ${l.length > 1 ? 'van' : 'va'} a rendir lo del catálogo.`);
      if (a.fuera > 0) anotar('alto' + a.emisor.id, 'aviso', a, (l, p) =>
        `${p}: ${l.length > 1 ? 'les' : 'le'} llegan ${rango(l, 'presionBoquilla')} bar, más que el máximo de la tabla de ${a.emisor.nombre} (${fmt(a.emisor.presiones.at(-1), 1)} bar). ${a.emisor.familia === 'turbina' ? 'Conviene bajar la presión.' : 'Conviene un cuerpo con regulador (PRS30 o PRS40).'}`);
      if (a.emisor.arcoDeTabla === false) anotar('arco' + a.emisor.id, 'info', a, (l, p) =>
        `${p}: el catálogo no trae la ${a.emisor.boquilla} a ${a.emisor.arco}°; el caudal se calculó en proporción al arco, entre los arcos de la tabla.`);
      if (a.regulador && a.presionEntrada < REGULACION[a.regulador]) anotar('reg' + a.regulador, 'aviso', a, (l, p) =>
        `${p}: entran ${rango(l, 'presionEntrada')} bar, menos que los ${fmt(REGULACION[a.regulador], 1)} bar del regulador ${a.regulador}: no llega a regular.`);
    }
    for (const g of grupos.values()) {
      const nums = g.lista.map(a => a.n);
      const quien = nums.length === 1 ? `Aspersor ${nums[0]}` : `Aspersores ${nums.join(', ')}`;
      avisos.push({ nivel: g.nivel, texto: g.armar(g.lista, quien) });
    }
    const rapidos = r.tramos.filter(t => t.velocidad > VELOCIDAD_MAX);
    if (rapidos.length) avisos.push({ nivel: 'aviso', texto: `El agua va a más de ${fmt(VELOCIDAD_MAX, 1)} m/s en ${rapidos.length === 1 ? 'el tramo hasta el aspersor ' + rapidos[0].hasta : rapidos.length + ' tramos'}: conviene un caño más grande.` });
    if (alim) { const v = velocidad(r.total, alim.di); if (v > VELOCIDAD_MAX) avisos.push({ nivel: 'aviso', texto: `En la alimentación el agua va a ${fmt(v, 2)} m/s: conviene un caño más grande.` }); }
    if (variacion > VARIACION_MAX) avisos.push({ nivel: 'aviso', texto: `Entre los aspersores la presión varía un ${fmt(variacion, 0)} % (más del ${VARIACION_MAX} % recomendado): el riego no va a ser parejo.` });
    const familias = new Set(r.asp.map(a => a.emisor.familia));
    if (familias.has('difusor') && familias.size > 1) avisos.push({ nivel: 'aviso', texto: 'El sector mezcla difusores con rotores (MP o turbinas): tiran agua a ritmos muy distintos y no conviene que compartan válvula.' });

    return {
      convergio, iteraciones: iter,
      caudalTotal: r.total,
      fuente: { presion: r.pFuente, bomba: pump ? { ...pump, altura: r.alturaBomba.valor } : null },
      alimentacion: alim ? { cano: alim.nombre, largo: alim.largo, perdida: r.perdAlim, velocidad: velocidad(r.total, alim.di) } : null,
      presionValvula: r.pValvula, perdidaValvula: r.perdValv.valor, presionSalidaValvula: r.pSalidaValvula,
      lateral: lat.nombre, tramos: r.tramos, aspersores: r.asp,
      variacion, avisos,
    };
  }

  // Prueba los diámetros del material del lateral y recomienda el más chico que cumple:
  // velocidad hasta 1,5 m/s, variación de presión hasta 20 % y ningún aspersor por debajo de su tabla.
  function recomendarDiametro(sector) {
    const tipo = CANOS[sector.lateral.material];
    const opciones = Object.keys(tipo.di).map(Number).sort((a, b) => a - b).map(nominal => {
      const r = calcularSector({ ...sector, lateral: { ...sector.lateral, nominal } });
      const vMax = Math.max(...r.tramos.map(t => t.velocidad));
      const bajos = r.aspersores.filter(a => a.fuera < 0).length;
      return { nominal, velocidadMax: vMax, variacion: r.variacion, caudal: r.caudalTotal, bajos,
        cumple: r.convergio && vMax <= VELOCIDAD_MAX && r.variacion <= VARIACION_MAX && bajos === 0 };
    });
    const elegida = opciones.find(o => o.cumple) || null;
    return { recomendado: elegida ? elegida.nominal : null, opciones };
  }

  // "2,24" o "2,24 a 2,28" según los valores de una lista de aspersores.
  function rango(lista, campo) {
    const vs = lista.map(a => a[campo]);
    const min = Math.min(...vs), max = Math.max(...vs);
    return fmt(min, 2) === fmt(max, 2) ? fmt(min, 2) : `${fmt(min, 2)} a ${fmt(max, 2)}`;
  }

  function fmt(v, dec) {
    return Number(v).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  global.RIEGO = {
    MCA_POR_BAR, VELOCIDAD_MAX, VARIACION_MAX, CANOS, REGULACION, TIPO_AJUSTABLE,
    interpolar, perdidaCano, velocidad, emisores, emisor, bomba, calcularSector, recomendarDiametro, fmt,
  };
})(typeof window !== 'undefined' ? window : globalThis);
