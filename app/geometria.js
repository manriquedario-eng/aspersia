// Geometría del plano: qué riega cada aspersor, cobertura del terreno y distancias del caño.
// Coordenadas en metros: x hacia la derecha, y hacia arriba (el norte del plano). Ángulos en grados,
// medidos como un rumbo: 0° hacia arriba y creciendo en el sentido de las agujas del reloj.
// "giro" es hacia dónde apunta el centro del abanico. Sin pantalla: lo usan el plano y las pruebas.

(function (global) {
  const rad = g => g * Math.PI / 180;
  // Rumbo de (dx, dy) en grados, 0..360
  const rumbo = (dx, dy) => (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  // Diferencia angular más corta entre dos rumbos, 0..180
  const difAngulo = (a, b) => { const d = Math.abs(((a - b) % 360 + 360) % 360); return d > 180 ? 360 - d : d; };

  // Forma de lo que riega un aspersor: abanico (radio + arco) o franja (rectángulo de las MP de franja).
  // tipoFranja: 'SS' (lateral, centrada), 'LCS' (esquina izquierda), 'RCS' (esquina derecha); largo = radio.
  function riega(asp, px, py) {
    const dx = px - asp.x, dy = py - asp.y;
    if (asp.franja) {
      // u: hacia adelante (giro); v: hacia la derecha
      const u = dx * Math.sin(rad(asp.giro)) + dy * Math.cos(rad(asp.giro));
      const v = dx * Math.cos(rad(asp.giro)) - dy * Math.sin(rad(asp.giro));
      if (u < 0 || u > asp.ancho) return false;
      if (asp.franja === 'SS') return Math.abs(v) <= asp.radio / 2;
      if (asp.franja === 'LCS') return v <= 0 && v >= -asp.radio;
      return v >= 0 && v <= asp.radio;
    }
    const d2 = dx * dx + dy * dy;
    if (d2 > asp.radio * asp.radio) return false;
    if (asp.arco >= 360 || d2 < 1e-9) return true;
    return difAngulo(rumbo(dx, dy), asp.giro) <= asp.arco / 2 + 1e-9;
  }

  // ---------- Zonas a regar ----------
  // Polígonos que se dibujan sobre la foto (la parte de tierra o pasto). Pueden tener cualquier forma.
  // Superficie (m²) por la fórmula del cordón de zapato.
  const areaPoligono = pol => Math.abs(pol.reduce((t, p, i) => { const q = pol[(i + 1) % pol.length]; return t + p.x * q.y - q.x * p.y; }, 0)) / 2;
  // ¿El punto está adentro? (rayo hacia la derecha; sirve para polígonos con entrantes)
  function dentroDePoligono(pol, x, y) {
    let dentro = false;
    for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) {
      const a = pol[i], b = pol[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) dentro = !dentro;
    }
    return dentro;
  }
  const enZonas = (zonas, x, y) => zonas.some(z => dentroDePoligono(z, x, y));
  // Lado de alguna zona más cercano a un punto (para tocar el lado que se conoce y escalar con su medida).
  function ladoMasCercano(zonas, p) {
    let mejor = null;
    zonas.forEach((z, k) => z.forEach((a, i) => {
      const b = z[(i + 1) % z.length], c = puntoMasCercano([a, b], p);
      if (!mejor || c.distancia < mejor.distancia) mejor = { zona: k, lado: i, a, b, distancia: c.distancia, largo: Math.hypot(b.x - a.x, b.y - a.y) };
    }));
    return mejor;
  }

  // Alinear un aspersor con el borde de la zona (Darío: el terreno no es parejo y el abanico no calzaba con la línea).
  // Cerca de una esquina (a menos de "esquina" m): abre lo que mide la esquina y apunta al medio, hacia adentro.
  // Si no, junto al lado más cercano: 180° con el borde del abanico sobre la línea, regando hacia adentro.
  // Los ángulos a menos de 4° de 90, 180 o 270 se redondean (para que sigan sirviendo las boquillas fijas).
  function alinearConBorde(zonas, p, esquina = 1) {
    if (!zonas || !zonas.length) return null;
    const redondo = a => { for (const r of [90, 180, 270]) if (Math.abs(a - r) <= 4) return r; return Math.round(a); };
    const adentro = (giro, d = 0.4) => enZonas(zonas, p.x + d * Math.sin(rad(giro)), p.y + d * Math.cos(rad(giro)));
    let cerca = null;
    zonas.forEach(z => z.forEach((v, i) => { const d = Math.hypot(v.x - p.x, v.y - p.y); if (d <= esquina && (!cerca || d < cerca.d)) cerca = { d, z, i }; }));
    if (cerca) {
      const { z, i } = cerca, v = z[i], ant = z[(i - 1 + z.length) % z.length], sig = z[(i + 1) % z.length];
      const b1 = rumbo(ant.x - v.x, ant.y - v.y), b2 = rumbo(sig.x - v.x, sig.y - v.y);
      const dif = ((b2 - b1) % 360 + 360) % 360;
      // De las dos aberturas posibles entre los lados, la que queda adentro de la zona
      const op = [{ arco: dif, giro: b1 + dif / 2 }, { arco: 360 - dif, giro: b1 + dif / 2 + 180 }].map(o => ({ ...o, giro: ((o.giro % 360) + 360) % 360 }));
      const o = op.find(x => adentro(x.giro, 0.6)) || op[0];
      return { tipo: 'esquina', arco: redondo(o.arco), giro: Math.round(o.giro) % 360 };
    }
    const lado = ladoMasCercano(zonas, p);
    const b = rumbo(lado.b.x - lado.a.x, lado.b.y - lado.a.y);
    const giros = [(b + 90) % 360, (b + 270) % 360];
    const giro = giros.find(g => adentro(g)) ?? giros[0];
    return { tipo: 'lado', arco: 180, giro: Math.round(giro) % 360, distancia: lado.distancia };
  }

  // Cuenta cuántos aspersores llegan a cada punto del terreno (una grilla de "paso" metros).
  // Devuelve la grilla y los porcentajes: seco (0), uno solo (1) y bien cubierto (2 o más).
  // Con zonas dibujadas, solo cuenta lo de adentro: lo de afuera queda marcado FUERA y no entra en los porcentajes.
  const FUERA = 255;
  function cobertura(terreno, aspersores, paso = 0.25, zonas = null) {
    const nx = Math.max(1, Math.round(terreno.ancho / paso)), ny = Math.max(1, Math.round(terreno.largo / paso));
    const cuenta = new Uint8Array(nx * ny);
    const conZonas = zonas && zonas.length;
    for (let j = 0; j < ny; j++) {
      const y = (j + 0.5) * terreno.largo / ny;
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * terreno.ancho / nx;
        if (conZonas && !enZonas(zonas, x, y)) { cuenta[j * nx + i] = FUERA; continue; }
        let n = 0;
        for (const a of aspersores) if (riega(a, x, y)) { n++; if (n === FUERA - 1) break; }
        cuenta[j * nx + i] = n;
      }
    }
    let seco = 0, uno = 0, total = 0;
    for (const c of cuenta) { if (c === FUERA) continue; total++; if (c === 0) seco++; else if (c === 1) uno++; }
    total ||= 1;
    return { nx, ny, cuenta, seco: seco / total * 100, uno: uno / total * 100, bien: (total - seco - uno) / total * 100 };
  }

  // Distancias del caño a partir del plano: de la válvula al primer aspersor y de cada uno al siguiente, en línea recta.
  // Los que todavía no están ubicados en el plano dan null (conservan la distancia que se escribió a mano).
  function distanciasDesdePlano(valvula, aspersores) {
    let px = valvula.x, py = valvula.y;
    return aspersores.map(a => {
      if (a.x == null || a.y == null) return null;
      const d = Math.hypot(a.x - px, a.y - py);
      px = a.x; py = a.y;
      return Math.round(d * 10) / 10;
    });
  }

  // ---------- Ramal: el caño principal de un sector ----------
  // Sale de la válvula y pasa por los codos que se marcan en el plano. Cada aspersor se conecta con una manguera
  // en línea recta hasta el punto más cercano del ramal: ahí se pincha el caño y va el conector inicial.
  const largoDeLinea = linea => linea.slice(1).reduce((t, p, i) => t + Math.hypot(p.x - linea[i].x, p.y - linea[i].y), 0);

  // Punto de la línea más cercano a p: { punto, distancia (de p a la línea), recorrido (metros desde el inicio de la línea) }.
  function puntoMasCercano(linea, p) {
    let mejor = null, recorrido = 0;
    for (let i = 0; i < linea.length - 1; i++) {
      const a = linea[i], b = linea[i + 1], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
      const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
      const q = { x: a.x + t * dx, y: a.y + t * dy }, d = Math.hypot(p.x - q.x, p.y - q.y);
      if (!mejor || d < mejor.distancia - 1e-9) mejor = { punto: q, distancia: d, recorrido: recorrido + t * L };
      recorrido += L;
    }
    return mejor;
  }

  // Pedazo de una línea entre dos recorridos (metros desde su inicio), para dibujar cada tramo con su diámetro.
  function subLinea(linea, desde, hasta) {
    const puntos = [];
    let recorrido = 0;
    for (let i = 0; i < linea.length - 1; i++) {
      const a = linea[i], b = linea[i + 1], L = Math.hypot(b.x - a.x, b.y - a.y);
      const en = r => ({ x: a.x + (b.x - a.x) * (r - recorrido) / (L || 1), y: a.y + (b.y - a.y) * (r - recorrido) / (L || 1) });
      if (recorrido + L >= desde && recorrido <= hasta) {
        if (!puntos.length) puntos.push(en(Math.max(desde, recorrido)));
        if (recorrido + L <= hasta) puntos.push(b); else { puntos.push(en(hasta)); break; }
      }
      recorrido += L;
    }
    return puntos;
  }

  // Conexión de cada aspersor al ramal, en el orden en que los va pasando el caño desde la válvula:
  // [{ i (índice del aspersor), punto, manguera (m), tramo (m de caño desde la conexión anterior o la válvula) }].
  // ¿El segmento a-b cruza el borde de alguna zona? (cruce de verdad: tocar el borde en una punta no cuenta,
  // así un aspersor puesto justo sobre el límite igual puede conectarse)
  function cruzaBorde(zonas, a, b) {
    const lado = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    for (const z of zonas || []) for (let i = 0; i < z.length; i++) {
      const p = z[i], q = z[(i + 1) % z.length];
      const d1 = lado(p, q, a), d2 = lado(p, q, b), d3 = lado(a, b, p), d4 = lado(a, b, q), e = 1e-9;
      if (((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e))) return true;
    }
    return false;
  }
  // Punto del caño donde se conecta la manguera: el más cercano al que se llega sin cruzar el límite del lote
  // (Darío: los límites son reales, como un muro). Si no hay ninguno, el más cercano.
  function conexionSinCruzar(linea, p, zonas) {
    const cerca = puntoMasCercano(linea, p);
    if (!zonas?.length || !cruzaBorde(zonas, p, cerca.punto)) return cerca;
    const largo = largoDeLinea(linea), paso = Math.max(0.05, Math.min(0.1, largo / 600));
    let mejor = null;
    for (let r = 0; r <= largo + 1e-9; r += paso) {
      const q = subLinea(linea, r, r)[0];
      if (!q) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if ((!mejor || d < mejor.distancia) && !cruzaBorde(zonas, p, q)) mejor = { punto: q, distancia: d, recorrido: r };
    }
    return mejor || cerca;
  }
  function conexionesAlRamal(valvula, ramal, aspersores, zonas = null) {
    const linea = [valvula, ...ramal];
    let anterior = 0;
    return aspersores.map((a, i) => ({ i, ...conexionSinCruzar(linea, a, zonas) }))
      .sort((x, y) => x.recorrido - y.recorrido || x.i - y.i)
      .map(c => {
        const tramo = c.recorrido - anterior;
        anterior = c.recorrido;
        return { i: c.i, punto: c.punto, manguera: c.distancia, tramo };
      });
  }

  // Ubicación de arranque de las válvulas que todavía no están en el plano: una debajo de la otra, junto a la fuente.
  // Los aspersores NO se ubican solos (Darío no quiere una fila automática): quedan "sin ubicar" hasta que se los pone.
  function ubicarSinPosicion(terreno, sectores) {
    sectores.forEach((s, k) => {
      if (!s.valvulaPos) s.valvulaPos = { x: 0.5, y: Math.round(Math.max(0.5, terreno.largo - 1 - k * 1.2) * 10) / 10 };
      for (const a of s.aspersores) if (a.x != null && a.giro == null) a.giro = 0;
    });
  }
  const sinUbicar = s => s.aspersores.filter(a => a.x == null || a.y == null);

  // Escala del plano a partir de una medida conocida: dos puntos (en los metros actuales del plano) y su largo real.
  // Devuelve el factor por el que hay que multiplicar todo para que esa distancia mida lo que dice el usuario.
  function factorDeEscala(a, b, metrosReales) {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(d > 0) || !(metrosReales > 0)) throw new Error('Marcá dos puntos distintos y escribí cuántos metros hay entre ellos.');
    return metrosReales / d;
  }

  // Aplica un factor de escala a todo el plano: terreno, imagen de fondo, fuente, válvulas, aspersores, ramales y zonas.
  // Todo se multiplica desde la esquina de abajo a la izquierda, así cada cosa queda sobre el mismo lugar de la imagen.
  function escalarPlano(plano, sectores, k) {
    const r1 = v => Math.round(v * 1000) / 1000;   // al milímetro: la medida que se escribe queda exacta
    plano.ancho = r1(plano.ancho * k);
    plano.largo = r1(plano.largo * k);
    if (plano.fondo) { plano.fondo.ancho *= k; plano.fondo.alto *= k; }
    const mover = p => { if (p && p.x != null) { p.x = r1(p.x * k); p.y = r1(p.y * k); } };
    mover(plano.fuente);
    for (const s of sectores) { mover(s.valvulaPos); s.aspersores.forEach(mover); (s.ramal || []).forEach(mover); }
    for (const z of plano.zonas || []) z.forEach(mover);
  }

  // ---------- Sugerir mejoras de cobertura (botón del plano; Darío: que sea una consulta, no un aviso) ----------
  // Prueba cambios chicos en cada aspersor: girarlo, abrir o cerrar el arco, correrlo o cambiarle la boquilla.
  // Arma una cadena: el mejor cambio, después el mejor con ese ya hecho, y así (hasta 6, uno por aspersor).
  // Ningún cambio puede mojar más afuera de la zona a regar (veredas, paredes, edificación): esos se descartan.
  // No cambia nada: devuelve las ideas para que Darío elija.
  // aspersores: los del plano ({x, y, giro, arco, radio, franja, ...}); opciones[k] = { arco: [min, max] | null,
  // boquillas: [{ boquilla, radio }] } (otras boquillas del mismo tipo que sirven con su arco).
  function sugerirCobertura(terreno, aspersores, zonas, opciones = [], paso = 0.35) {
    const nx = Math.max(1, Math.round(terreno.ancho / paso)), ny = Math.max(1, Math.round(terreno.largo / paso));
    const dx = terreno.ancho / nx, dy = terreno.largo / ny;
    const px = i => (i + 0.5) * dx, py = j => (j + 0.5) * dy;
    const conZonas = zonas && zonas.length;
    const dentro = (x, y) => x >= 0 && y >= 0 && x <= terreno.ancho && y <= terreno.largo && (!conZonas || enZonas(zonas, x, y));
    const adentro = new Uint8Array(nx * ny);
    let total = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (dentro(px(i), py(j))) { adentro[j * nx + i] = 1; total++; }
    if (!total || aspersores.length < 2) return { antes: null, pasos: [], faltan: [], paso };
    const lista = aspersores.map(a => ({ ...a }));
    const cuenta = new Uint8Array(nx * ny);
    const caja = a => {   // celdas que puede tocar un aspersor
      const r = a.franja ? Math.max(a.radio, a.ancho || 1.5) + 0.5 : a.radio;
      return { i0: Math.max(0, Math.floor((a.x - r) / dx)), i1: Math.min(nx - 1, Math.ceil((a.x + r) / dx)),
        j0: Math.max(0, Math.floor((a.y - r) / dy)), j1: Math.min(ny - 1, Math.ceil((a.y + r) / dy)) };
    };
    const sumar = (a, signo) => { const c = caja(a); for (let j = c.j0; j <= c.j1; j++) for (let i = c.i0; i <= c.i1; i++) if (adentro[j * nx + i] && riega(a, px(i), py(j))) cuenta[j * nx + i] += signo; };
    // Cuánto moja afuera de la zona (o del terreno): puntos de muestra dentro del alcance que caen afuera
    const afuera = a => {
      const r = a.franja ? Math.max(a.radio, a.ancho || 1.5) : a.radio, n = 14;
      let c = 0;
      for (let u = 0; u < n; u++) for (let v = 0; v < n; v++) {
        const x = a.x - r + (u + 0.5) * 2 * r / n, y = a.y - r + (v + 0.5) * 2 * r / n;
        if (riega(a, x, y) && !dentro(x, y)) c += (2 * r / n) ** 2;
      }
      return c;   // m²
    };
    lista.forEach(a => sumar(a, 1));
    const costoCelda = n => n === 0 ? 3 : n === 1 ? 1 : 0;   // seco pesa más que regado por uno solo
    const estado = () => {
      let seco = 0, uno = 0;
      for (let k = 0; k < cuenta.length; k++) if (adentro[k]) { if (!cuenta[k]) seco++; else if (cuenta[k] === 1) uno++; }
      return { seco: seco / total * 100, uno: uno / total * 100, bien: (total - seco - uno) / total * 100 };
    };
    const antes = estado();
    // Cambio de costo si el aspersor a pasa a ser b (los demás quedan como están)
    function delta(a, b) {
      const ca = caja(a), cb = caja(b);
      const i0 = Math.min(ca.i0, cb.i0), i1 = Math.max(ca.i1, cb.i1), j0 = Math.min(ca.j0, cb.j0), j1 = Math.max(ca.j1, cb.j1);
      let d = 0, bien = 0;
      const ganadas = [];
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        if (!adentro[k]) continue;
        const x = px(i), y = py(j), con = cuenta[k] - (riega(a, x, y) ? 1 : 0) + (riega(b, x, y) ? 1 : 0);
        const dd = costoCelda(con) - costoCelda(cuenta[k]);
        d += dd;
        if (dd < 0) ganadas.push([Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
        bien += (con >= 2) - (cuenta[k] >= 2);
      }
      return { d, bien, ganadas };
    }
    function pruebasDe(a, op) {
      const pruebas = [];
      if (!a.franja && a.arco < 360) for (const g of [-30, -20, -10, -5, 5, 10, 20, 30]) pruebas.push({ tipo: 'girar', valor: g, b: { ...a, giro: ((a.giro + g) % 360 + 360) % 360 } });
      if (!a.franja && op.arco) for (const d of [-30, -15, -5, 5, 15, 30, 45]) {
        let arco = Math.round(a.arco + d);
        if (arco >= 355) arco = 360;
        if (arco < op.arco[0] || arco > op.arco[1] || arco === a.arco) continue;
        pruebas.push({ tipo: 'arco', valor: arco, b: { ...a, arco } });
      }
      for (const alt of op.boquillas || []) if (alt.boquilla !== a.boquilla)
        pruebas.push({ tipo: 'boquilla', valor: alt.boquilla, de: a.boquilla, b: { ...a, radio: alt.radio, boquilla: alt.boquilla } });
      for (let r = 0; r < 8; r++) for (const m of [0.3, 0.6, 1]) {
        const ang = r * 45, x = Math.round((a.x + m * Math.sin(ang * Math.PI / 180)) * 10) / 10, y = Math.round((a.y + m * Math.cos(ang * Math.PI / 180)) * 10) / 10;
        if (dentro(x, y)) pruebas.push({ tipo: 'mover', valor: { x, y, metros: m, rumbo: ang }, b: { ...a, x, y } });
      }
      return pruebas;
    }
    const pasos = [], tocados = new Set();
    for (let vuelta = 0; vuelta < 6; vuelta++) {
      let mejor = null;
      lista.forEach((a, k) => {
        if (tocados.has(k)) return;
        const fueraAntes = afuera(a);
        for (const p of pruebasDe(a, opciones[k] || {})) {
          // Nunca mojar más afuera de la línea del terreno (tolerancia: 0,1 m² por redondeo de la muestra)
          if (afuera(p.b) > fueraAntes + 0.1) continue;
          const r = delta(a, p.b);
          if (r.d >= 0) continue;
          // Correr un aspersor o cambiarle la boquilla cuesta más en la obra que girarlo: tiene que ganar claramente más
          const puntaje = r.d + (p.tipo === 'mover' ? p.valor.metros * 2 : p.tipo === 'boquilla' ? 2 : 0);
          if (!mejor || puntaje < mejor.puntaje) mejor = { ...p, k, puntaje, ...r };
        }
      });
      if (!mejor || -mejor.d / total * 100 < 0.3) break;
      const a = lista[mejor.k];
      const c = mejor.ganadas.length ? { x: mejor.ganadas.reduce((t, g) => t + g[0], 0) / mejor.ganadas.length, y: mejor.ganadas.reduce((t, g) => t + g[1], 0) / mejor.ganadas.length } : { x: a.x, y: a.y };
      // El vecino: el otro aspersor más cerca de lo que se gana (para decir "entre el 3 y el 5")
      const vecino = lista.map((o, n) => ({ n, d: n === mejor.k ? Infinity : Math.hypot(o.x - c.x, o.y - c.y) })).sort((p, q) => p.d - q.d)[0].n;
      // Para un círculo completo que conviene correr: de qué lado superpone mucho y de cuál poco
      let lados = null;
      if (mejor.tipo === 'mover' && a.arco >= 360 && !a.franja) {
        const ladoDe = deg => { let mucho = 0, n = 0; const cc = caja(a);
          for (let j = cc.j0; j <= cc.j1; j++) for (let i = cc.i0; i <= cc.i1; i++) { const kk = j * nx + i, x = px(i), y = py(j);
            if (!adentro[kk] || !riega(a, x, y) || difAngulo(rumbo(x - a.x, y - a.y), deg) > 90) continue; n++; if (cuenta[kk] >= 3) mucho++; }
          return n ? mucho / n : 0; };
        lados = { haciaDonde: ladoDe(mejor.valor.rumbo), contrario: ladoDe(mejor.valor.rumbo + 180) };
      }
      pasos.push({ k: mejor.k, tipo: mejor.tipo, valor: mejor.valor, de: mejor.de, bien: mejor.bien / total * 100, menosSeco: -mejor.d / total * 100,
        vecino, lados, punto: c, celdas: mejor.ganadas });
      sumar(a, -1); lista[mejor.k] = mejor.b; sumar(mejor.b, 1); tocados.add(mejor.k);
    }
    const despues = estado();
    // Partes regadas por uno solo o secas que quedan después de esos cambios: ahí convendría otro aspersor
    const visto = new Uint8Array(nx * ny), faltan = [];
    for (let k0 = 0; k0 < cuenta.length; k0++) {
      if (!adentro[k0] || visto[k0] || cuenta[k0] >= 2) continue;
      const pila = [k0], celdas = []; visto[k0] = 1; let secas = 0;
      while (pila.length) {
        const k = pila.pop(), i = k % nx, j = (k - i) / nx;
        celdas.push([Math.round(px(i) * 100) / 100, Math.round(py(j) * 100) / 100]); if (!cuenta[k]) secas++;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj, kk = jj * nx + ii;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny || visto[kk] || !adentro[kk] || cuenta[kk] >= 2) continue;
          visto[kk] = 1; pila.push(kk);
        }
      }
      const m2 = celdas.length * dx * dy;
      if (m2 >= 2) faltan.push({ x: Math.round(celdas.reduce((t, c) => t + c[0], 0) / celdas.length * 10) / 10, y: Math.round(celdas.reduce((t, c) => t + c[1], 0) / celdas.length * 10) / 10,
        m2: Math.round(m2 * 10) / 10, seca: secas / celdas.length > 0.5, celdas });
    }
    faltan.sort((p, q) => q.m2 - p.m2);
    return { antes, despues, pasos, faltan: faltan.slice(0, 3), paso: { x: dx, y: dy } };
  }

  global.GEOMETRIA = { cruzaBorde, alinearConBorde, sugerirCobertura, rumbo, difAngulo, riega, cobertura, distanciasDesdePlano, ubicarSinPosicion, factorDeEscala, escalarPlano,
    largoDeLinea, puntoMasCercano, conexionesAlRamal, subLinea, areaPoligono, dentroDePoligono, enZonas, ladoMasCercano, FUERA, sinUbicar };
})(typeof window !== 'undefined' ? window : globalThis);
