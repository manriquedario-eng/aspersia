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

  // Caños: diámetro interior por tamaño nominal (diámetro exterior).
  // PVC K6 Tigre: catálogo Tigre "Agua Fría", pág. 10, "Tubo soldable PVC CL 6": exterior menos dos espesores
  // (40 → 1,3 mm; 50 → 1,7; 63 → 1,9; 75 → 2,2; lo confirma el catálogo "Redes de Agua", pág. 19).
  // La tabla de clase 6 empieza en 40 mm: para 32 mm se usa el espesor de clase 10 (1,6 mm), del lado seguro.
  // El resto, de las tablas de Hunter, págs. 215, 216, 219 y 220.
  const CANOS = {
    'pvc-k6':    { nombre: 'PVC K6', detalle: 'PVC clase 6 junta pegada (Tigre)', C: 150, pagina: 'Tigre, Agua Fría pág. 10',
      di: { 32: 28.8, 40: 37.4, 50: 46.6, 63: 59.2, 75: 70.6 } },
    'pead-pn6':  { nombre: 'PEAD PN6', detalle: 'Polietileno PEAD PN6 (SDR 17,6)', C: 140, pagina: 219,
      di: { 25: 21.4, 32: 28.4, 40: 35.4, 50: 44.2, 63: 55.8, 75: 66.4, 90: 79.8, 110: 97.4 } },
    'pead-pn10': { nombre: 'PEAD PN10', detalle: 'Polietileno PEAD PN10 (SDR 11)', C: 140, pagina: 220,
      di: { 25: 20.4, 32: 26.2, 40: 32.6, 50: 40.8, 63: 51.4, 75: 61.4, 90: 73.6, 110: 90.0 } },
    'pvc-c4':    { nombre: 'PVC clase 4', detalle: 'PVC clase 4 (10 bar)', C: 150, pagina: 215,
      di: { 25: 22.0, 32: 28.4, 40: 36.2, 50: 45.2, 63: 57.0, 75: 67.8, 90: 81.4, 110: 99.4 } },
    'pvc-c5':    { nombre: 'PVC clase 5', detalle: 'PVC clase 5 (16 bar)', C: 150, pagina: 216,
      di: { 25: 21.2, 32: 27.2, 40: 34.0, 50: 42.6, 63: 53.6, 75: 63.8, 90: 76.6, 110: 93.6 } },
  };

  // Manguera de polietileno que va del conector inicial (en el caño del ramal) a la espiga en L de cada aspersor.
  // La de ½" y la de 16 mm se usan igual (Darío): un solo tipo, clase K4. Conector inicial + espiga en L
  // se cuentan como 1 m más de manguera (estimado). Darío: hasta 6 m de manguera por aspersor.
  const MANGUERAS = {
    'pe-12': { nombre: 'Polietileno K4 de ½" o 16 mm', corto: '½"', di: 13.6, C: 140 },   // Ø interior de la ficha Tigre Rural ½" (13,5 a 13,7 mm; 16 mm es el exterior)
  };
  const ACCESORIOS_MANGUERA_M = 1;
  const MANGUERA_MAX_M = 6;

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

  // Electroválvula Hunter PGV según el caudal del sector y el caño que sale de ella (Darío: con caño de 50 no va
  // una de 1", ahorca el caño). Por caño: hasta 40 mm → 1"; 50 mm → 1½"; 63 mm o más → 2".
  // Por caudal (catálogo págs. 87 y 89): PGV-101 hasta 150 l/min; PGV-151 hasta 27 m3/h (450 l/min); PGV-201 hasta 34 m3/h.
  const VALVULAS = [
    { medida: '1"', modelo: 'PGV-101', clave: '1', maxLmin: 150, tabla: () => global.HUNTER.pgv1 },
    { medida: '1½"', modelo: 'PGV-151', clave: '15', maxLmin: 450, tabla: () => global.HUNTER.pgv15 },
    { medida: '2"', modelo: 'PGV-201', clave: '2', maxLmin: 34 * 1000 / 60, tabla: () => global.HUNTER.pgv2 },
  ];
  function elegirValvula(caudalLmin, nominalCano) {
    const porCano = nominalCano >= 63 ? 2 : nominalCano >= 50 ? 1 : 0;
    const porCaudal = caudalLmin <= 150 ? 0 : caudalLmin <= 450 ? 1 : 2;
    const v = VALVULAS[Math.max(porCano, porCaudal)];
    return { ...v, tabla: v.tabla() };
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
  //
  // Las MP Rotator también son de arco ajustable, pero cada modelo tiene sus rangos (pág. 53): de 90° a 210°,
  // de 210° a 270° (otro color de la misma boquilla) o círculo completo; la MP3500 solo de 90° a 210°.
  // El id es "mp-MP2000@120". Entre 271° y 359° no hay boquilla MP.
  const TIPO_AJUSTABLE = 'Boquilla Pro ajustable';
  const TIPO_MP = 'MP Rotator';
  function emisorAjustable(boquilla, arco, tipo = TIPO_AJUSTABLE) {
    const base = emisores().filter(e => e.tipo === tipo && e.boquilla === boquilla).sort((a, b) => a.arco - b.arco);
    if (!base.length) throw new Error('Boquilla ajustable desconocida: ' + boquilla);
    if (tipo === TIPO_MP) {
      const max = boquilla === 'MP3500' ? 210 : 270;
      if (!((arco >= 90 && arco <= max) || (arco === 360 && boquilla !== 'MP3500')))
        throw new Error(boquilla === 'MP3500' ? 'La MP3500 se ajusta de 90° a 210°.' : `La ${boquilla} se ajusta de 90° a 270° o va en círculo completo (360°).`);
    } else if (!(arco >= 1 && arco <= 360)) throw new Error(`El arco de la ${boquilla} tiene que estar entre 1° y 360°`);
    const exacta = base.find(e => e.arco === arco);
    const porPresion = (campo, i) => {
      if (exacta) return exacta[campo][i];
      if (arco < base[0].arco) return campo === 'caudales' ? base[0][campo][i] * arco / base[0].arco : base[0][campo][i];
      return interpolar(base.map(e => e.arco), base.map(e => e[campo][i]), arco).valor;
    };
    const ref = base[0];
    return {
      ...ref, id: `${tipo === TIPO_MP ? 'mp' : 'pro'}-${boquilla}@${arco}`, arco, nombre: `${boquilla} ${arco}°`,
      arcoDeTabla: !!exacta,
      radios: ref.presiones.map((_, i) => porPresion('radios', i)),
      caudales: ref.presiones.map((_, i) => porPresion('caudales', i)),
    };
  }

  function emisor(id) {
    const ajustable = /^pro-(.+)@(\d+(?:\.\d+)?)$/.exec(id);
    if (ajustable) return emisorAjustable(ajustable[1], Number(ajustable[2]));
    const mp = /^mp-(MP\d+)@(\d+(?:\.\d+)?)$/.exec(id);
    if (mp) return emisorAjustable(mp[1], Number(mp[2]), TIPO_MP);
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
  //   valvula: true | false,                                    // electroválvula PGV (1", 1½" o 2": se elige sola, ver elegirValvula)
  //   lateral: { material, nominal, tramos? },                  // caño del sector, después de la válvula;
  //       tramos: [nominal de cada tramo] para un caño escalonado (tramo i = el que llega al aspersor i)
  //   manguera: 'pe-12' | null,                                 // manguera del conector inicial a cada aspersor
  //   aspersores: [{ emisor, regulador: null | 'PRS30' | 'PRS40', distancia, altura, manguera }],
  //       distancia: metros de caño desde el punto anterior (la válvula o el aspersor anterior)
  //       altura: metros respecto de la válvula (+ más alto)
  //       manguera: metros de manguera desde el conector inicial hasta la espiga del aspersor (0 = va directo al caño)
  //   accesorios: 10,                                           // % que se suma a la fricción por codos y tes
  // }
  function calcularSector(sector) {
    const avisos = [];
    const acc = 1 + (sector.accesorios ?? 10) / 100;
    const alim = sector.alimentacion && sector.alimentacion.largo > 0
      ? { ...cano(sector.alimentacion.material, sector.alimentacion.nominal), largo: sector.alimentacion.largo, desnivel: sector.alimentacion.desnivel || 0 }
      : null;
    const lat = cano(sector.lateral.material, sector.lateral.nominal);
    const latTramo = i => sector.lateral.tramos?.[i] ? { ...cano(sector.lateral.material, sector.lateral.tramos[i]), nominal: sector.lateral.tramos[i] } : { ...lat, nominal: sector.lateral.nominal };
    const mang = sector.manguera ? MANGUERAS[sector.manguera] : null;
    if (sector.manguera && !mang) throw new Error('Manguera desconocida: ' + sector.manguera);
    const asps = sector.aspersores.map((a, i) => ({
      ...a, n: i + 1, e: emisor(a.emisor),
      reg: a.regulador ? REGULACION[a.regulador] : null,
      distancia: a.distancia || 0, altura: a.altura || 0,
      manguera: mang ? Math.max(0, a.manguera || 0) : 0,
    }));
    if (!asps.length) throw new Error('El sector todavía no tiene aspersores: ponelos en el plano con "+ Aspersor" o con "+ Agregar aspersor".');
    const pump = sector.fuente.tipo === 'bomba' ? bomba(sector.fuente.linea, sector.fuente.modelo) : null;
    const nominalSalida = sector.lateral.tramos?.[0] ?? sector.lateral.nominal;   // el caño que sale de la válvula

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
      const valv = elegirValvula(total, nominalSalida);
      const perdValv = sector.valvula ? { ...interpolar(valv.tabla.perdida.map(f => f[0] * 1000 / 60), valv.tabla.perdida.map(f => f[1]), total), valv } : { valor: 0, fuera: 0, valv };
      let p = pValvula - perdValv.valor;
      const pSalidaValvula = p;

      const tramos = [], asp = [];
      let alturaAnterior = 0;
      for (let i = 0; i < asps.length; i++) {
        const a = asps[i];
        const qTramo = caudales.slice(i).reduce((s, v) => s + v, 0);
        const ct = latTramo(i);
        const friccion = perdidaCano(qTramo, a.distancia, ct.di, ct.C) * acc;
        p -= friccion + (a.altura - alturaAnterior) / MCA_POR_BAR;
        alturaAnterior = a.altura;
        tramos.push({ hasta: a.n, largo: a.distancia, nominal: ct.nominal, caudal: qTramo, perdida: friccion, velocidad: velocidad(qTramo, ct.di) });
        // Derivación al aspersor: conector inicial + manguera + espiga en L. Pierde solo con el caudal de ese
        // aspersor y no cambia la presión del caño para los que siguen.
        const perdManguera = a.manguera > 0 ? perdidaCano(caudales[i], a.manguera + ACCESORIOS_MANGUERA_M, mang.di, mang.C) : 0;
        const pEntrada = p - perdManguera;
        const pBoquilla = a.reg != null ? Math.min(pEntrada, a.reg) : pEntrada;
        const c = interpolar(a.e.presiones, a.e.caudales, pBoquilla);
        const r = interpolar(a.e.presiones, a.e.radios, pBoquilla);
        asp.push({ n: a.n, emisor: a.e, regulador: a.regulador || null, presionCano: p, presionEntrada: pEntrada, presionBoquilla: pBoquilla,
          caudal: c.valor, radio: r.valor, fuera: c.fuera,
          manguera: a.manguera, perdidaManguera: perdManguera, velocidadManguera: a.manguera > 0 ? velocidad(caudales[i], mang.di) : 0 });
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
    if (sector.valvula && r.total > r.perdValv.valv.maxLmin) avisos.push({ nivel: 'error', texto: `El caudal (${fmt(r.total, 0)} l/min) supera los ${fmt(r.perdValv.valv.maxLmin, 0)} l/min que admite la válvula ${r.perdValv.valv.modelo} de ${r.perdValv.valv.medida}.` });
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
    const mangLargas = r.asp.filter(a => a.manguera > MANGUERA_MAX_M);
    if (mangLargas.length) {
      const nums = mangLargas.map(a => a.n);
      avisos.push({ nivel: 'aviso', texto: `${nums.length === 1 ? 'Aspersor' : 'Aspersores'} ${nums.join(', ')}: ${rango(mangLargas, 'manguera')} m de manguera, más de los ${MANGUERA_MAX_M} m que se usan como máximo por aspersor. Conviene acercar el caño.` });
    }
    const mangRapidas = r.asp.filter(a => a.velocidadManguera > VELOCIDAD_MAX);
    if (mangRapidas.length) {
      const nums = mangRapidas.map(a => a.n);
      avisos.push({ nivel: 'aviso', texto: `${nums.length === 1 ? 'Aspersor' : 'Aspersores'} ${nums.join(', ')}: por la manguera de ${mang.corto} el agua va a ${rango(mangRapidas, 'velocidadManguera')} m/s y pierde ${rango(mangRapidas, 'perdidaManguera')} bar. Conviene manguera más grande, o conectar${nums.length === 1 ? 'lo' : 'los'} directo al caño.` });
    }
    const rapidos = r.tramos.filter(t => t.velocidad > VELOCIDAD_MAX);
    if (rapidos.length) avisos.push({ nivel: 'aviso', texto: `El agua va a más de ${fmt(VELOCIDAD_MAX, 1)} m/s en ${rapidos.length === 1 ? 'el tramo hasta el aspersor ' + rapidos[0].hasta : rapidos.length + ' tramos'}: conviene un caño más grande.` });
    if (alim) { const v = velocidad(r.total, alim.di); if (v > VELOCIDAD_MAX) avisos.push({ nivel: 'aviso', texto: `En la alimentación el agua va a ${fmt(v, 2)} m/s: conviene un caño más grande.` }); }
    if (variacion > VARIACION_MAX) avisos.push({ nivel: 'aviso', texto: `Entre los aspersores la presión varía un ${fmt(variacion, 0)} % (más del ${VARIACION_MAX} % recomendado): el riego no va a ser parejo.` });
    const familias = new Set(r.asp.map(a => a.emisor.familia));
    if (familias.has('difusor') && familias.size > 1) avisos.push({ nivel: 'aviso', texto: 'El sector mezcla difusores con rotores (MP o turbinas): tiran agua a ritmos muy distintos y no conviene que compartan válvula.' });

    return {
      convergio, iteraciones: iter,
      // El total es exactamente la suma de lo que muestra cada aspersor (la iteración deja una diferencia de milésimas).
      caudalTotal: r.asp.reduce((t, a) => t + a.caudal, 0),
      fuente: { presion: r.pFuente, bomba: pump ? { ...pump, altura: r.alturaBomba.valor } : null },
      alimentacion: alim ? { cano: alim.nombre, largo: alim.largo, perdida: r.perdAlim, velocidad: velocidad(r.total, alim.di) } : null,
      presionValvula: r.pValvula, perdidaValvula: r.perdValv.valor,
      valvula: sector.valvula ? { medida: r.perdValv.valv.medida, modelo: r.perdValv.valv.modelo, clave: r.perdValv.valv.clave } : null, presionSalidaValvula: r.pSalidaValvula,
      lateral: lat.nombre, tramos: r.tramos, aspersores: r.asp,
      variacion, avisos,
    };
  }

  // Prueba los diámetros del material del lateral y recomienda el más chico que cumple:
  // velocidad hasta 1,5 m/s, variación de presión hasta 20 % y ningún aspersor por debajo de su tabla.
  function recomendarDiametro(sector) {
    const tipo = CANOS[sector.lateral.material];
    const opciones = Object.keys(tipo.di).map(Number).sort((a, b) => a - b).map(nominal => {
      const r = calcularSector({ ...sector, lateral: { material: sector.lateral.material, nominal } });
      const vMax = Math.max(...r.tramos.map(t => t.velocidad));
      const bajos = r.aspersores.filter(a => a.fuera < 0).length;
      return { nominal, velocidadMax: vMax, variacion: r.variacion, caudal: r.caudalTotal, bajos,
        cumple: r.convergio && vMax <= VELOCIDAD_MAX && r.variacion <= VARIACION_MAX && bajos === 0 };
    });
    const elegida = opciones.find(o => o.cumple) || null;
    return { recomendado: elegida ? elegida.nominal : null, opciones };
  }

  // Caño escalonado (Darío: en tirones largos se sale grueso de la bomba y se va reduciendo, por ejemplo 63 → 50 → 40 mm).
  // Por cada tramo pasa el agua de los aspersores que quedan adelante: se elige el diámetro más chico que la lleva
  // a 1,5 m/s o menos, sin agrandarse hacia el final. Si la presión entre aspersores varía más del 20 %, se agranda
  // el tramo que más pierde (y los de antes, para que nunca crezca hacia el final) hasta que cumpla o no haya más grande.
  function escalonar(sector) {
    const tipo = CANOS[sector.lateral.material];
    const nominales = Object.keys(tipo.di).map(Number).sort((a, b) => a - b);
    const calc = tramos => calcularSector({ ...sector, lateral: { ...sector.lateral, tramos } });
    const n = sector.aspersores.length;
    let tramos = Array(n).fill(nominales.at(-1));
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      const r = calc(tramos);
      const nuevo = r.tramos.map(t => nominales.find(d => velocidad(t.caudal, tipo.di[d]) <= VELOCIDAD_MAX) ?? nominales.at(-1));
      for (let i = 1; i < n; i++) nuevo[i] = Math.min(nuevo[i], nuevo[i - 1]);
      tramos = nuevo;
    }
    let r = calc(tramos);
    for (let guarda = 0; r.variacion > VARIACION_MAX && guarda < 40; guarda++) {
      const cand = r.tramos.map((t, i) => ({ i, perdida: t.perdida })).filter(c => tramos[c.i] < nominales.at(-1)).sort((a, b) => b.perdida - a.perdida);
      if (!cand.length) break;
      const i = cand[0].i, d = nominales[nominales.indexOf(tramos[i]) + 1];
      for (let j = 0; j <= i; j++) tramos[j] = Math.max(tramos[j], d);
      r = calc(tramos);
    }
    return { tramos, resultado: r };
  }

  // Tramos de un mismo diámetro, uno detrás del otro: [{ nominal, desde (n° de aspersor), hasta, largo (m) }]
  function tramosPorDiametro(tramos) {
    const lista = [];
    for (const t of tramos) {
      const ultimo = lista.at(-1);
      if (ultimo && ultimo.nominal === t.nominal) { ultimo.hasta = t.hasta; ultimo.largo += t.largo; }
      else lista.push({ nominal: t.nominal, desde: t.hasta, hasta: t.hasta, largo: t.largo });
    }
    return lista;
  }

  // "2,24" o "2,24 a 2,28" según los valores de una lista de aspersores.
  function rango(lista, campo) {
    const vs = lista.map(a => a[campo]);
    const min = Math.min(...vs), max = Math.max(...vs);
    return fmt(min, 2) === fmt(max, 2) ? fmt(min, 2) : `${fmt(min, 2)} a ${fmt(max, 2)}`;
  }

  // Número escrito a la argentina o con punto: "5,12" → 5,12; "5.12" → 5,12; "20.000" → 20000; "1.234,5" → 1234,5.
  // Vacío o inválido → NaN.
  function leerNumero(v) {
    let t = String(v ?? '').trim().replace(/[\s$]/g, '');
    if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    else t = t.replace(',', '.');
    return t === '' ? NaN : Number(t);
  }

  function fmt(v, dec) {
    return Number(v).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  global.RIEGO = {
    MCA_POR_BAR, VELOCIDAD_MAX, VARIACION_MAX, CANOS, MANGUERAS, ACCESORIOS_MANGUERA_M, MANGUERA_MAX_M, REGULACION, TIPO_AJUSTABLE, TIPO_MP,
    interpolar, perdidaCano, velocidad, elegirValvula, emisores, emisor, bomba, calcularSector, recomendarDiametro, escalonar, tramosPorDiametro, leerNumero, fmt,
  };
})(typeof window !== 'undefined' ? window : globalThis);
