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
  // Con el caño "automático" (escalonado), cada tramo lleva el diámetro que calcula RIEGO.escalonar.
  const escalonados = new Map();   // datos del sector → diámetros por tramo (se recalcula solo si algo cambió)
  function tramosEscalonados(datos) {
    const clave = JSON.stringify(datos);
    if (!escalonados.has(clave)) {
      let tramos = null;
      try { tramos = R().escalonar(datos).tramos; } catch { /* sector con error: se calcula sin escalonar y muestra el error */ }
      if (escalonados.size > 300) escalonados.clear();
      escalonados.set(clave, tramos);
    }
    return escalonados.get(clave);
  }
  const paraCalcular = obra => s => {
    const { escalonado, tramos, ...lateral } = s.lateral;
    const d = {
      fuente: obra.fuente.tipo === 'bomba'
        ? { tipo: 'bomba', linea: obra.fuente.linea, modelo: obra.fuente.modelo, aspiracion: obra.fuente.aspiracion }
        : { tipo: 'presion', bar: obra.fuente.bar },
      alimentacion: s.alimentacion, valvula: s.valvula, lateral, manguera: s.manguera || null,
      aspersores: s.aspersores.map((a, i) => ({ num: a.num ?? i + 1, emisor: idEmisor(a), regulador: a.regulador || null, distancia: a.distancia, altura: a.altura, manguera: a.manguera || 0 })),
      accesorios: obra.accesorios,
    };
    const porTramo = tramosDelRamal(s);
    if (porTramo && d.aspersores.length) {
      // Cada aspersor toma la medida del caño en la mitad del tramo que le llega
      let acum = 0;
      d.lateral = { ...lateral, tramos: d.aspersores.map(a => { const medio = acum + (a.distancia || 0) / 2; acum += a.distancia || 0; return nominalEn(porTramo, medio); }) };
    } else if (escalonado && d.aspersores.length) {
      const t = tramosEscalonados(d);
      if (t) d.lateral = { ...lateral, tramos: t };
    }
    return d;
  };

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
  // Medida a mano por tramo del caño (Darío: "del 1 al 2 de 50 y del 2 al 3 de 40"). s.ramalDiametros[k] = diámetro del
  // tramo k (0 = de la válvula al primer punto). Devuelve los tramos dibujados con su medida, o null si no se eligió por tramo.
  function tramosDelRamal(s) {
    if (!tieneRamal(s) || !s.ramalDiametros?.some(Boolean)) return null;
    const linea = [s.valvulaPos, ...s.ramal];
    let desde = 0, ultimo = s.lateral.nominal;
    return linea.slice(1).map((p, k) => {
      const largo = Math.hypot(p.x - linea[k].x, p.y - linea[k].y);
      ultimo = s.ramalDiametros[k] || ultimo;
      const t = { k, nominal: ultimo, desde, hasta: desde + largo, largo };
      desde += largo;
      return t;
    });
  }
  // Diámetro del caño en un punto del recorrido (metros desde la válvula), con la medida por tramo
  const nominalEn = (tramos, recorrido) => (tramos.find(t => recorrido <= t.hasta + 1e-9) || tramos.at(-1)).nominal;
  const largoRamal = s => tieneRamal(s) ? global.GEOMETRIA.largoDeLinea([s.valvulaPos, ...s.ramal]) : null;
  const codosRamal = s => tieneRamal(s) ? s.ramal.length - 1 : 0;

  // Con "calcular los caños con las distancias del plano", las distancias entre aspersores y el largo hasta
  // cada válvula salen de las posiciones. Un sector con ramal dibujado sale siempre del plano (orden, tramos y mangueras).
  // Se llama antes de cualquier cálculo, así todo usa los mismos metros.
  // Las válvulas van juntas a la salida de la bomba (Darío: el 99 % de las veces), en un colector: un caño corto
  // con una T por cada sector menos el último, que lleva un codo. Cada válvula queda a 0,5 m de la anterior y
  // el caño hasta ella (la "alimentación" del cálculo) es ese tramo de colector.
  const SEPARACION_VALVULAS = 0.5;
  function ubicarValvulas(obra) {
    const f = obra.plano?.fuente;
    if (!f) return;
    const hacia = f.x <= obra.plano.ancho / 2 ? 1 : -1;   // hacia adentro del terreno
    obra.sectores.forEach((s, k) => {
      const d = SEPARACION_VALVULAS * (k + 1);
      s.valvulaPos = { x: r1(f.x + hacia * d), y: f.y };
      if (s.alimentacion) s.alimentacion.largo = d;
    });
  }

  // Número de cada aspersor (Darío): el que le tocó al ponerlo, aunque el caño los ordene distinto para el cálculo.
  // Los nuevos (o los que llegan de otro sector con un número repetido) toman el siguiente; al quitar uno,
  // los de arriba bajan un lugar para que no queden huecos.
  function numerar(s) {
    const usados = new Set(), nuevos = [];
    for (const a of s.aspersores) {
      if (Number.isInteger(a.num) && a.num > 0 && !usados.has(a.num)) usados.add(a.num); else nuevos.push(a);
    }
    const viejos = s.aspersores.filter(a => !nuevos.includes(a)).sort((p, q) => p.num - q.num);
    viejos.forEach((a, k) => { a.num = k + 1; });
    nuevos.forEach((a, k) => { a.num = viejos.length + k + 1; });
  }
  const numero = (s, i) => s.aspersores[i]?.num ?? i + 1;

  function sincronizarDistancias(obra) {
    obra.sectores.forEach(numerar);
    if (!obra.plano) return;
    ubicarValvulas(obra);
    const desdePlano = obra.plano.distanciasDesdePlano;
    if (!desdePlano && !obra.sectores.some(tieneRamal)) return;
    for (const s of obra.sectores) {
      if (tieneRamal(s)) aplicarRamal(s);
      else if (desdePlano) global.GEOMETRIA.distanciasDesdePlano(s.valvulaPos, s.aspersores).forEach((d, i) => { if (d != null) s.aspersores[i].distancia = d; });
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
        lista.push({ s: k, i, num: a.num ?? i + 1, x: a.x, y: a.y, giro: a.giro || 0, radio, arco, franja, ancho: 1.5, nombre: e.nombre, trayectoria: trayectoria(e) });
      });
    });
    return lista;
  }

  // Diámetro del caño en el tramo que llega a cada aspersor (escalonado o el mismo para todos), para el plano.
  const diametrosDelSector = (obra, s) => { const lat = paraCalcular(obra)(s).lateral; return s.aspersores.map((a, i) => lat.tramos?.[i] ?? lat.nominal); };

  // ---------- Caja: cobros, gastos y ganancia ----------
  // Cada obra guarda lo que pagó el cliente (cobros) y lo que se gastó en ella (gastos: materiales, combustible, todo).
  // Ganancia = cobrado − gastado. Se reparte en partes iguales entre los socios (Darío y Leandro).
  const sumaImportes = lista => (lista || []).reduce((t, x) => t + (Number(x.importe) || 0), 0);
  function cajaDeObra(obra, precios) {
    let total = 0;
    try { total = presupuesto(obra, precios).total || 0; } catch { /* obra con error: sin total */ }
    const cobrado = sumaImportes(obra.cobros), gastado = sumaImportes(obra.gastos);
    const ganancia = cobrado - gastado;
    return { total, cobrado, falta: Math.max(0, total - cobrado), gastado, ganancia,
      gananciaPrevista: Math.max(total, cobrado) - gastado,
      margen: cobrado > 0 ? ganancia / cobrado * 100 : null };
  }
  // Por mes (AAAA-MM, según la fecha de cada cobro y cada gasto), con el acumulado desde el primer mes.
  function cajaPorMes(obras) {
    const meses = new Map();
    const mes = f => (f || '').slice(0, 7) || 'sin fecha';
    const de = m => { if (!meses.has(m)) meses.set(m, { mes: m, cobrado: 0, gastado: 0 }); return meses.get(m); };
    for (const o of obras) {
      for (const c of o.cobros || []) de(mes(c.fecha)).cobrado += Number(c.importe) || 0;
      for (const g of o.gastos || []) de(mes(g.fecha)).gastado += Number(g.importe) || 0;
    }
    let acumulado = 0;
    return [...meses.values()].sort((a, b) => a.mes.localeCompare(b.mes)).map(m => {
      m.ganancia = m.cobrado - m.gastado;
      acumulado += m.ganancia;
      return { ...m, acumulado };
    });
  }

  // Superficie de las zonas a regar dibujadas en el plano (m²), o null si no hay ninguna.
  const superficieZonas = obra => obra.plano?.zonas?.length ? obra.plano.zonas.reduce((t, z) => t + global.GEOMETRIA.areaPoligono(z), 0) : null;

  // ---------- Sugerir riego completo (Darío: otro plano aparte para comparar; su obra no se toca) ----------
  // Arma un diseño desde cero sobre la misma zona, la misma bomba y la misma foto:
  //   1) un aspersor en cada esquina, con el arco que mide la esquina;
  //   2) aspersores de 180° a lo largo de cada lado, separados lo justo para que se mojen cabeza a cabeza;
  //   3) si queda ancho, círculos completos adentro en triángulo, a la misma separación;
  // y elige la boquilla (Pro ajustable o PGP Ultra) que logra buena cobertura con menos aspersores sin mojar afuera.
  // Después los reparte en sectores según lo que da la bomba y dibuja el caño de cada sector por el medio.
  // Devuelve una obra nueva (copia), marcada con propuestaDe = id de la obra original.
  function proponerRiego(obra) {
    const G = global.GEOMETRIA, Rg = R(), A = global.ALMACEN;
    const t = obra.plano;
    const zonas = t.zonas?.length ? t.zonas : [[{ x: 0, y: 0 }, { x: t.ancho, y: 0 }, { x: t.ancho, y: t.largo }, { x: 0, y: t.largo }]];
    const area = zonas.reduce((s, z) => s + G.areaPoligono(z), 0);
    const emisor = a => { try { return Rg.emisor(idEmisor(a)); } catch { return null; } };
    const medio = v => v[Math.floor(v.length / 2)];
    // Boquillas candidatas, con el alcance y el caudal del medio de su tabla
    const candidatas = [];
    for (const [tipo, filtro] of [['Boquilla Pro ajustable', b => /HE$/.test(b)], ['Turbina PGP Ultra', () => true]]) {
      const boqs = [...new Set(Rg.emisores().filter(e => e.tipo === tipo).map(e => e.boquilla))].filter(filtro);
      for (const boquilla of boqs) {
        const e = emisor({ tipo, boquilla, arco: 180 });
        if (e) candidatas.push({ tipo, boquilla, radio: medio(e.radios) });
      }
    }
    const adentro = (p, d = 0.05) => G.enZonas(zonas, p.x, p.y) || zonas.some(z => G.puntoMasCercano([...z, z[0]], p).distancia <= d);
    function armar(c) {
      const sep = c.radio * 0.95;   // cabeza a cabeza, con un poco de margen
      const asps = [];
      const poner = (x, y, giro, arco) => asps.push({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, giro: Math.round(giro) % 360, arco: Math.round(arco), radio: c.radio });
      for (const z of zonas) z.forEach((v, i) => {
        const al = G.alinearConBorde(zonas, v, 0.01);
        if (al) poner(v.x, v.y, al.giro, al.arco);
        const w = z[(i + 1) % z.length], largo = Math.hypot(w.x - v.x, w.y - v.y), n = Math.max(1, Math.ceil(largo / sep));
        for (let k = 1; k < n; k++) {
          const p = { x: v.x + (w.x - v.x) * k / n, y: v.y + (w.y - v.y) * k / n };
          const b = G.rumbo(w.x - v.x, w.y - v.y), giros = [(b + 90) % 360, (b + 270) % 360];
          const giro = giros.find(g => G.enZonas(zonas, p.x + 0.4 * Math.sin(g * Math.PI / 180), p.y + 0.4 * Math.cos(g * Math.PI / 180))) ?? giros[0];
          poner(p.x, p.y, giro, 180);
        }
      });
      // Adentro, en triángulo, lejos de los bordes (los bordes ya tienen sus aspersores)
      const xs = zonas.flat().map(p => p.x), ys = zonas.flat().map(p => p.y);
      const fila = sep * 0.866;
      for (let j = 1, y = Math.min(...ys) + fila; y < Math.max(...ys); j++, y += fila)
        for (let x = Math.min(...xs) + (j % 2 ? sep / 2 : sep); x < Math.max(...xs); x += sep) {
          const p = { x, y };
          if (!G.enZonas(zonas, x, y)) continue;
          const borde = Math.min(...zonas.map(z => G.puntoMasCercano([...z, z[0]], p).distancia));
          if (borde >= c.radio) poner(x, y, 0, 360);   // a un alcance del borde: el círculo no moja afuera
        }
      const cob = G.cobertura(t, asps, Math.max(0.15, Math.min(0.4, Math.sqrt(area) / 60)), zonas);
      // Lo que moja afuera de la zona (veredas, paredes): muestreo dentro del alcance de cada uno
      let afuera = 0;
      for (const a of asps) for (let u = 0; u < 12; u++) for (let v = 0; v < 12; v++) {
        const x = a.x - a.radio + (u + 0.5) * a.radio / 6, y = a.y - a.radio + (v + 0.5) * a.radio / 6;
        if (G.riega(a, x, y) && !adentro({ x, y }, 0)) afuera += (a.radio / 6) ** 2;
      }
      return { c, asps, cob, afuera };
    }
    const opciones = candidatas.map(armar).filter(o => o.asps.length);
    // La mejor: buena cobertura (90 % o más bien cubierto) mojando poco afuera, con la menor cantidad de aspersores
    const sirve = o => o.cob.bien >= 90 && o.afuera <= area * 0.05;   // casi nada afuera (Darío: no romper la línea del terreno)
    const elegida = opciones.filter(sirve).sort((p, q) => p.asps.length - q.asps.length || p.afuera - q.afuera)[0]
      || opciones.sort((p, q) => (q.cob.bien - q.afuera / area * 100) - (p.cob.bien - p.afuera / area * 100))[0];
    if (!elegida) throw new Error('No se pudo armar una propuesta: dibujá primero la zona a regar.');
    const { c } = elegida;

    // Caudal de cada aspersor y lo que da la fuente por sector
    const caudalDe = a => { const e = emisor({ tipo: c.tipo, boquilla: c.boquilla, arco: a.arco }); return e ? medio(e.caudales) : 10; };
    let capacidad = 40;   // canilla: unos 40 l/min (no se conoce el caudal de la red)
    if (obra.fuente.tipo === 'bomba') {
      try {
        const b = Rg.bomba(obra.fuente.linea, obra.fuente.modelo), altura = 30 + (obra.fuente.aspiracion || 0);   // ~3 bar a la salida
        const ok = b.caudales.filter((q, i) => b.alturas[i] >= altura);
        capacidad = ok.length ? Math.max(...ok) : b.caudales[0];
      } catch { /* bomba desconocida: queda el valor de canilla */ }
    }
    capacidad *= 0.9;
    // Sectores en gajos que salen desde la bomba (así cada caño va derecho a su sector sin cruzar los otros):
    // los aspersores se ordenan por la dirección en que se ven desde la bomba y se corta cuando se pasa del caudal
    const f = t.fuente || { x: 0, y: 0 };
    const angulos = elegida.asps.map(a => ({ a, r: G.rumbo(a.x - f.x, a.y - f.y) })).sort((p, q) => p.r - q.r);
    let corte = 0, hueco = -1;
    angulos.forEach((p, i) => { const sig = angulos[(i + 1) % angulos.length], h = ((sig.r - p.r) % 360 + 360) % 360 || (angulos.length === 1 ? 360 : 0); if (h > hueco) { hueco = h; corte = (i + 1) % angulos.length; } });
    const ordenados = [...angulos.slice(corte), ...angulos.slice(0, corte)].map(p => p.a);
    const eje = (lista, mx, my) => {
      let sxx = 0, syy = 0, sxy = 0;
      for (const a of lista) { sxx += (a.x - mx) ** 2; syy += (a.y - my) ** 2; sxy += (a.x - mx) * (a.y - my); }
      const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      return { x: Math.cos(ang), y: Math.sin(ang) };
    };
    const grupos = [[]];
    let suma = 0;
    for (const a of ordenados) {
      const q = caudalDe(a);
      if (grupos.at(-1).length && suma + q > capacidad) { grupos.push([]); suma = 0; }
      grupos.at(-1).push(a); suma += q;
    }

    const nueva = JSON.parse(JSON.stringify(obra));
    Object.assign(nueva, {
      id: A.nuevoId(), creada: A.hoy(), actualizada: A.hoy(), estado: 'Borrador', cobros: [], gastos: [],
      nombre: 'Propuesta de la app', propuestaDe: obra.id,
      propuesta: { boquilla: `${c.tipo} ${c.boquilla}`, aspersores: elegida.asps.length, bien: Math.round(elegida.cob.bien), capacidad: Math.round(capacidad) },
    });
    nueva.presupuesto = { ...nueva.presupuesto, cambios: {}, propios: [], congelado: null, manoObra: { ...(obra.presupuesto.manoObra || {}), fijo: null } };
    nueva.plano.trabado = false;
    nueva.sectores = grupos.map((g, k) => {
      const s = A.sectorNuevo(k + 1);
      s.lateral = { ...s.lateral, escalonado: true };
      s.aspersores = g.map((a, i) => ({ tipo: c.tipo, boquilla: c.boquilla, arco: a.arco, regulador: '', distancia: 1, altura: 0, manguera: 1, x: a.x, y: a.y, giro: a.giro, num: i + 1 }));
      return s;
    });
    ubicarValvulas(nueva);
    // Caño de cada sector: de la válvula al comienzo del eje del sector y por el medio, hasta la otra punta
    nueva.sectores.forEach(s => {
      const mx = s.aspersores.reduce((t, a) => t + a.x, 0) / s.aspersores.length, my = s.aspersores.reduce((t, a) => t + a.y, 0) / s.aspersores.length;
      const e = s.aspersores.length > 1 ? eje(s.aspersores, mx, my) : { x: 1, y: 0 };
      const pr = s.aspersores.map(a => (a.x - mx) * e.x + (a.y - my) * e.y);
      let p1 = { x: mx + e.x * Math.min(...pr), y: my + e.y * Math.min(...pr) }, p2 = { x: mx + e.x * Math.max(...pr), y: my + e.y * Math.max(...pr) };
      if (Math.hypot(p2.x - s.valvulaPos.x, p2.y - s.valvulaPos.y) < Math.hypot(p1.x - s.valvulaPos.x, p1.y - s.valvulaPos.y)) [p1, p2] = [p2, p1];
      const r2 = v => Math.round(v * 100) / 100;
      s.ramal = (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 0.5 ? [p1] : [p1, p2]).map(p => ({ x: r2(p.x), y: r2(p.y) }));
    });
    sincronizarDistancias(nueva);
    return nueva;
  }

  global.OBRA = { proponerRiego, tramosDelRamal, nominalEn, numerar, numero, esAjustable, esMP, arcoLibre, ponerArco, cajaDeObra, cajaPorMes, superficieZonas, diametrosDelSector, ubicarValvulas, SEPARACION_VALVULAS, tieneRamal, largoRamal, codosRamal, MANGUERA_MINIMA, idEmisor, paraCalcular, calcular, sincronizarDistancias, presupuesto, trayectoria, aspersoresDelPlano };
})(typeof window !== 'undefined' ? window : globalThis);
