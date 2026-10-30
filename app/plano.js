// Plano de la obra: terreno, aspersores con su abanico real, válvulas, fuente, caños, cobertura y sol y sombra.
// Se arrastra con el dedo (aspersores, válvulas y fuente), se gira tocando un aspersor y se hace zoom con dos dedos.
// Dibuja en SVG con coordenadas en metros. Usa GEOMETRIA (app/geometria.js) y SOL (app/sol.js).

(function (global) {
  const G = global.GEOMETRIA, S = global.SOL;
  const NS = 'http://www.w3.org/2000/svg';
  const COLORES = ['#0a9ae9', '#8b5cf6', '#f97316', '#14b8a6', '#e11d48', '#ca8a04', '#2563eb', '#58a003'];
  const colorSector = k => COLORES[k % COLORES.length];
  const r1 = v => Math.round(v * 10) / 10;

  let ctx = null;        // { obra, aspersores(), alCambiar(), contenedor, ... }
  let vista = null;      // viewBox actual { x, y, w, h } en metros (y del SVG, hacia abajo)
  let seleccion = null;  // { tipo: 'asp'|'valvula'|'fuente'|'sombra', s, i }
  let soloSector = null; // índice de sector a mostrar, o null para todos
  let cuadro = 0;
  let marcando = null;   // { n, etiquetas, puntos: [{x, y}], alMarcar(n), alTerminar(...puntos) } mientras se marcan puntos con toques
  let solGuardado = null; // { clave, mapa }: el mapa de sol no depende de los aspersores; se recalcula solo si cambia algo suyo

  const plano = () => ctx.obra.plano;
  const Y = y => plano().largo - y;          // del plano (y hacia arriba) al SVG (y hacia abajo)
  const el = (tag, attrs = {}, padre) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (padre) padre.appendChild(e);
    return e;
  };

  // Forma de un aspersor para dibujar: abanico (path) o franja (polígono).
  function forma(a) {
    const cx = a.x, cy = Y(a.y);
    if (a.franja) {
      const g = a.giro * Math.PI / 180, W = a.ancho, L = a.radio;
      const vs = a.franja === 'SS' ? [-L / 2, L / 2] : a.franja === 'LCS' ? [-L, 0] : [0, L];
      const p = (u, v) => `${cx + u * Math.sin(g) + v * Math.cos(g)},${cy - (u * Math.cos(g) - v * Math.sin(g))}`;
      return ['polygon', { points: [p(0, vs[0]), p(0, vs[1]), p(W, vs[1]), p(W, vs[0])].join(' ') }];
    }
    if (a.arco >= 360) return ['circle', { cx, cy, r: a.radio }];
    const punto = rumbo => { const t = rumbo * Math.PI / 180; return `${cx + a.radio * Math.sin(t)} ${cy - a.radio * Math.cos(t)}`; };
    const ini = a.giro - a.arco / 2, fin = a.giro + a.arco / 2;
    return ['path', { d: `M ${cx} ${cy} L ${punto(ini)} A ${a.radio} ${a.radio} 0 ${a.arco > 180 ? 1 : 0} 1 ${punto(fin)} Z` }];
  }

  // Mapa de cobertura como imagen: rojo seco, amarillo un solo aspersor, transparente bien cubierto.
  function imagenCobertura(c) {
    const lienzo = document.createElement('canvas');
    lienzo.width = c.nx; lienzo.height = c.ny;
    const g = lienzo.getContext('2d');
    const img = g.createImageData(c.nx, c.ny);
    for (let j = 0; j < c.ny; j++) for (let i = 0; i < c.nx; i++) {
      const n = c.cuenta[j * c.nx + i];
      const k = ((c.ny - 1 - j) * c.nx + i) * 4;      // la fila 0 de la grilla es el borde de abajo del terreno
      const [r, gr, b, al] = n === 0 ? [225, 29, 72, 110] : n === 1 ? [234, 179, 8, 80] : [10, 154, 233, 28];
      img.data[k] = r; img.data[k + 1] = gr; img.data[k + 2] = b; img.data[k + 3] = al;
    }
    g.putImageData(img, 0, 0);
    return lienzo.toDataURL();
  }

  // Mapa de sol como imagen: naranja sol pleno, amarillo media sombra, violeta sombra, gris bajo techo.
  function imagenSol(m) {
    const lienzo = document.createElement('canvas');
    lienzo.width = m.nx; lienzo.height = m.ny;
    const g = lienzo.getContext('2d');
    const img = g.createImageData(m.nx, m.ny);
    for (let j = 0; j < m.ny; j++) for (let i = 0; i < m.nx; i++) {
      const h = m.horas[j * m.nx + i];
      const k = ((m.ny - 1 - j) * m.nx + i) * 4;
      const [r, gr, b, al] = h < 0 ? [100, 116, 139, 120] : h >= 6 ? [249, 115, 22, 90] : h >= 3 ? [250, 204, 21, 80] : [67, 56, 202, 120];
      img.data[k] = r; img.data[k + 1] = gr; img.data[k + 2] = b; img.data[k + 3] = al;
    }
    g.putImageData(img, 0, 0);
    return lienzo.toDataURL();
  }
  function mapaSol() {
    const t = plano();
    const opciones = { latitud: t.latitud ?? -34.6, norte: t.norte || 0, epoca: t.epoca || 'verano' };
    const clave = JSON.stringify([t.ancho, t.largo, t.sombras, opciones]);
    if (solGuardado?.clave !== clave) solGuardado = { clave, mapa: S.mapa(t, t.sombras || [], opciones) };
    return solGuardado.mapa;
  }

  function visibles() {
    return ctx.aspersores().filter(a => soloSector == null || a.s === soloSector);
  }

  // ---------- Dibujo ----------
  function pintar() {
    cuadro = 0;
    const svg = ctx.svg, t = plano();
    if (!svg.clientWidth) return;     // plano oculto (por ejemplo, con la vista 3D abierta): se dibuja al volver
    svg.innerHTML = '';
    if (!vista) ajustar();
    svg.setAttribute('viewBox', `${vista.x} ${vista.y} ${vista.w} ${vista.h}`);
    const escala = vista.w / svg.clientWidth || 0.05;            // metros por pixel de pantalla
    // Foto o captura de fondo (su esquina de abajo a la izquierda es el origen del plano), terreno y cuadrícula cada metro
    if (t.fondo) el('image', { href: t.fondo.imagen, x: 0, y: Y(t.fondo.alto), width: t.fondo.ancho, height: t.fondo.alto,
      preserveAspectRatio: 'none', opacity: (t.fondo.opacidad ?? 70) / 100, class: 'fondo-imagen' }, svg);
    el('rect', { x: 0, y: 0, width: t.ancho, height: t.largo, class: t.fondo ? 'terreno con-fondo' : 'terreno' }, svg);
    const grilla = el('g', { class: 'grilla' }, svg);
    for (let x = 1; x < t.ancho; x++) el('line', { x1: x, y1: 0, x2: x, y2: t.largo, class: x % 5 ? '' : 'fuerte' }, grilla);
    for (let y = 1; y < t.largo; y++) el('line', { x1: 0, y1: Y(y), x2: t.ancho, y2: Y(y), class: y % 5 ? '' : 'fuerte' }, grilla);
    const asps = visibles();
    // Cobertura
    let cob = null;
    if (t.verCobertura && asps.length) {
      cob = G.cobertura(t, asps, Math.max(0.1, Math.min(0.25, Math.max(t.ancho, t.largo) / 240)));
      el('image', { href: imagenCobertura(cob), x: 0, y: 0, width: t.ancho, height: t.largo, preserveAspectRatio: 'none', class: t.fondo ? 'cobertura sobre-fondo' : 'cobertura' }, svg);
    }
    // Sol y sombra
    let sol = null;
    if (t.verSol) {
      sol = mapaSol();
      el('image', { href: imagenSol(sol), x: 0, y: 0, width: t.ancho, height: t.largo, preserveAspectRatio: 'none', class: t.fondo ? 'cobertura sobre-fondo' : 'cobertura' }, svg);
    }
    // Lo que hace sombra: casas, muros y árboles
    const capaSombras = el('g', { class: 'sombras' }, svg);
    (t.sombras || []).forEach((o, k) => {
      const g = el('g', { 'data-sombra': k, class: `sombra-obj ${o.tipo} ${seleccion?.tipo === 'sombra' && seleccion.i === k ? 'elegida' : ''}` }, capaSombras);
      let cx = o.x, cy = o.y;
      if (o.tipo === 'arbol') el('circle', { cx: o.x, cy: Y(o.y), r: o.radio, 'stroke-width': 1.5 * escala }, g);
      else {
        const pol = S.huella(o).poligono;
        el('polygon', { points: pol.map(p => `${p.x},${Y(p.y)}`).join(' '), 'stroke-width': 1.5 * escala }, g);
        cx = pol.reduce((a, p) => a + p.x, 0) / pol.length; cy = pol.reduce((a, p) => a + p.y, 0) / pol.length;
      }
      const txt = el('text', { x: cx, y: Y(cy) + 4 * escala, 'font-size': 11 * escala, 'stroke-width': 3 * escala, class: 'texto-sombra' }, g);
      txt.textContent = `${String(o.altura).replace('.', ',')} m`;
    });
    // Abanicos
    const abanicos = el('g', {}, svg);
    for (const a of asps) {
      const [tag, attrs] = forma(a);
      el(tag, { ...attrs, fill: colorSector(a.s), 'fill-opacity': t.verCobertura || t.verSol ? 0.08 : 0.18, stroke: colorSector(a.s), 'stroke-width': 1.2 * escala, 'stroke-opacity': 0.8 }, abanicos);
    }
    // Caños: fuente → válvula → aspersores, en orden
    const sectores = ctx.obra.sectores;
    const canos = el('g', { class: 'canos' }, svg);
    sectores.forEach((s, k) => {
      if (soloSector != null && k !== soloSector) return;
      const pts = [`${t.fuente.x},${Y(t.fuente.y)}`, `${s.valvulaPos.x},${Y(s.valvulaPos.y)}`, ...s.aspersores.map(a => `${a.x},${Y(a.y)}`)];
      el('polyline', { points: pts.join(' '), stroke: colorSector(k), 'stroke-width': 2 * escala, 'stroke-dasharray': `${6 * escala} ${4 * escala}`, fill: 'none' }, canos);
    });
    // Fuente
    const rf = 9 * escala;
    const f = el('g', { 'data-mover': 'fuente', class: `pieza ${seleccion?.tipo === 'fuente' ? 'elegida' : ''}` }, svg);
    el('circle', { cx: t.fuente.x, cy: Y(t.fuente.y), r: rf * 2.2, class: 'tocar' }, f);
    el('polygon', { points: `${t.fuente.x},${Y(t.fuente.y) - rf} ${t.fuente.x - rf},${Y(t.fuente.y) + rf * 0.8} ${t.fuente.x + rf},${Y(t.fuente.y) + rf * 0.8}`, class: 'fuente' }, f);
    // Válvulas
    sectores.forEach((s, k) => {
      if (soloSector != null && k !== soloSector) return;
      const v = el('g', { 'data-mover': 'valvula', 'data-s': k, class: `pieza ${seleccion?.tipo === 'valvula' && seleccion.s === k ? 'elegida' : ''}` }, svg);
      el('circle', { cx: s.valvulaPos.x, cy: Y(s.valvulaPos.y), r: rf * 2.2, class: 'tocar' }, v);
      el('rect', { x: s.valvulaPos.x - rf * 0.8, y: Y(s.valvulaPos.y) - rf * 0.8, width: rf * 1.6, height: rf * 1.6, fill: colorSector(k), class: 'valvula' }, v);
    });
    // Puntos marcados con toques (para escalar o para marcar lo que hace sombra)
    svg.classList.toggle('calibrando', !!marcando);
    if (marcando) {
      const rc = 6 * escala;
      if (marcando.puntos.length > 1)
        el('polyline', { points: marcando.puntos.map(p => `${p.x},${Y(p.y)}`).join(' '), fill: 'none', 'stroke-width': 2.5 * escala, class: 'linea-calibrar' }, svg);
      marcando.puntos.forEach((p, k) => {
        el('circle', { cx: p.x, cy: Y(p.y), r: rc, 'stroke-width': 1.5 * escala, class: 'marca-calibrar' }, svg);
        const txt = el('text', { x: p.x + rc * 1.4, y: Y(p.y) - rc * 1.2, 'font-size': rc * 3, 'stroke-width': 3 * escala, class: 'texto-calibrar' }, svg);
        txt.textContent = marcando.etiquetas[k];
      });
    }
    // Aspersores (encima de todo)
    for (const a of asps) {
      const g = el('g', { 'data-mover': 'asp', 'data-s': a.s, 'data-i': a.i, class: `pieza ${seleccion?.tipo === 'asp' && seleccion.s === a.s && seleccion.i === a.i ? 'elegida' : ''}` }, svg);
      el('circle', { cx: a.x, cy: Y(a.y), r: rf * 2.2, class: 'tocar' }, g);
      el('circle', { cx: a.x, cy: Y(a.y), r: rf, fill: colorSector(a.s), class: 'cabeza' }, g);
      const txt = el('text', { x: a.x, y: Y(a.y) + rf * 0.4, 'font-size': rf * 1.15, class: 'numero-plano' }, g);
      txt.textContent = a.i + 1;
    }
    if (ctx.rosa) ctx.rosa.style.transform = `rotate(${t.norte || 0}deg)`;
    pintarDatos(cob, sol, asps);
  }

  const pct = v => `<b>${v.toFixed(0)} %</b>`;
  function pintarDatos(cob, sol, asps) {
    const t = plano();
    let html = '';
    if (cob) html = `<span class="dato seco">${pct(cob.seco)} seco</span><span class="dato uno">${pct(cob.uno)} un solo aspersor</span><span class="dato bien">${pct(cob.bien)} bien cubierto</span>`;
    if (sol) {
      const epoca = S.EPOCAS[t.epoca || 'verano'].toLowerCase();
      html = `<span class="dato sol">${pct(sol.sol)} sol pleno</span><span class="dato media">${pct(sol.media)} media sombra</span><span class="dato sombra">${pct(sol.sombra)} sombra</span>`;
      html += `<p class="ayuda">En ${epoca}, el sol pega unas ${String(sol.luz).replace('.', ',')} h por día. Sol pleno: 6 h o más de sol directo; sombra: menos de 3 h.`;
      if (!(t.sombras || []).length) html += ' Marcá la casa, los muros y los árboles para ver dónde hay sombra.';
      html += '</p>';
      for (const p of S.porSector(sol, t, asps, G.riega)) {
        const nombre = (ctx.obra.sectores[p.s].nombre || `Sector ${p.s + 1}`).replace(/[<>&]/g, '');
        html += p.mezcla
          ? `<p class="aviso-sol">⚠ <b>${nombre}</b>: ${pct(p.sol)} al sol y ${pct(p.sombra)} a la sombra. Conviene separar la parte al sol y la parte a la sombra en sectores distintos: la del sol necesita más riego.</p>`
          : `<p class="ayuda sector-sol"><i style="background:${colorSector(p.s)}"></i>${nombre}: ${p.sol.toFixed(0)} % sol pleno, ${p.media.toFixed(0)} % media sombra, ${p.sombra.toFixed(0)} % sombra.</p>`;
      }
    }
    ctx.estadisticas.innerHTML = html;
    if (ctx.leyenda) ctx.leyenda.innerHTML = sol
      ? '<i class="sol"></i> sol pleno <i class="media"></i> media sombra <i class="sombra"></i> sombra <i class="techo"></i> techo · ▲ fuente · ■ válvula'
      : '<i class="seco"></i> seco <i class="uno"></i> un solo aspersor <i class="bien"></i> bien cubierto (dos o más) · ▲ fuente · ■ válvula';
    pintarSeleccion();
  }

  // Panel del elemento tocado: posición exacta y giro.
  function pintarSeleccion() {
    const caja = ctx.seleccion;
    if (!seleccion) { caja.innerHTML = '<p class="ayuda">Tocá un aspersor para girarlo o ponerle la posición exacta. Arrastrá para moverlo; con dos dedos, zoom.</p>'; return; }
    if (seleccion.tipo === 'sombra') {
      const o = plano().sombras[seleccion.i], tipo = S.TIPOS[o.tipo];
      caja.innerHTML = `<p class="sel-titulo">${tipo.nombre} · ${String(o.altura).replace('.', ',')} m de alto</p>
        <div class="giros">${tipo.alturas.map(([h, txt]) => `<button type="button" class="chico ${o.altura === h ? 'activo' : ''}" data-altura="${h}">${txt}</button>`).join('')}</div>
        <p class="ayuda">Arrastralo para acomodarlo. Si la altura no es exacta, no importa: alcanza con una idea.</p>
        <button type="button" class="chico peligro" data-quitar-sombra>Quitar</button>`;
      return;
    }
    const obj = objeto(seleccion);
    let titulo = 'Fuente de agua (bomba o llave)';
    let giro = '';
    if (seleccion.tipo === 'valvula') titulo = `Válvula de ${ctx.obra.sectores[seleccion.s].nombre}`;
    if (seleccion.tipo === 'asp') {
      const a = ctx.aspersores().find(x => x.s === seleccion.s && x.i === seleccion.i);
      titulo = `${ctx.obra.sectores[a.s].nombre} · aspersor ${a.i + 1}: ${a.nombre} · alcance ${a.radio.toFixed(1).replace('.', ',')} m`;
      giro = a.arco >= 360 && !a.franja ? '<p class="ayuda">Círculo completo: no hace falta girarlo.</p>' : `
        <label>Giro <span class="unidad">° (0 = hacia arriba)</span><input type="number" inputmode="numeric" step="5" data-sel="giro" value="${Math.round(obj.giro)}"></label>
        <div class="giros"><button type="button" class="chico" data-girar="-45">⟲ 45°</button><button type="button" class="chico" data-girar="-15">⟲ 15°</button>
        <button type="button" class="chico" data-girar="15">15° ⟳</button><button type="button" class="chico" data-girar="45">45° ⟳</button></div>`;
    }
    caja.innerHTML = `<p class="sel-titulo">${titulo.replace(/[<>&]/g, '')}</p>
      <div class="campos dos">
        <label>X <span class="unidad">m desde la izquierda</span><input type="number" inputmode="decimal" step="0.1" data-sel="x" value="${obj.x}"></label>
        <label>Y <span class="unidad">m desde abajo</span><input type="number" inputmode="decimal" step="0.1" data-sel="y" value="${obj.y}"></label>
      </div>${giro}`;
  }

  function objeto(sel) {
    if (sel.tipo === 'fuente') return plano().fuente;
    if (sel.tipo === 'valvula') return ctx.obra.sectores[sel.s].valvulaPos;
    return ctx.obra.sectores[sel.s].aspersores[sel.i];
  }

  // Vista que muestra todo el terreno con un margen.
  function ajustar() {
    const t = plano(), m = Math.max(1.5, Math.max(t.ancho, t.largo) * 0.06);
    const svg = ctx.svg;
    const proporcion = (svg.clientHeight || 300) / (svg.clientWidth || 300);
    let w = t.ancho + 2 * m, h = t.largo + 2 * m;
    if (h / w > proporcion) w = h / proporcion; else h = w * proporcion;
    vista = { x: t.ancho / 2 - w / 2, y: t.largo / 2 - h / 2, w, h };
  }
  function zoom(factor, cx, cy) {
    cx ??= vista.x + vista.w / 2; cy ??= vista.y + vista.h / 2;
    const w = Math.min(500, Math.max(2, vista.w * factor)), k = w / vista.w;
    vista = { x: cx - (cx - vista.x) * k, y: cy - (cy - vista.y) * k, w, h: vista.h * k };
    pintar();
  }
  const repintar = () => { if (!cuadro) cuadro = requestAnimationFrame(pintar); };

  // ---------- Toque y arrastre ----------
  const punteros = new Map();
  let gesto = null;
  function aSVG(ev) {
    const p = ctx.svg.createSVGPoint();
    p.x = ev.clientX; p.y = ev.clientY;
    return p.matrixTransform(ctx.svg.getScreenCTM().inverse());
  }
  function alBajar(ev) {
    try { ctx.svg.setPointerCapture(ev.pointerId); } catch { /* algunos navegadores no lo permiten: igual funciona */ }
    punteros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (punteros.size === 2) {
      const [a, b] = [...punteros.values()];
      gesto = { tipo: 'pellizco', dist: Math.hypot(a.x - b.x, a.y - b.y), vista: { ...vista } };
      return;
    }
    const pieza = marcando ? null : ev.target.closest('[data-mover]');   // al marcar puntos, un toque marca un punto
    const p = aSVG(ev);
    // Lo que hace sombra: un toque lo elige; ya elegido, se arrastra (así una casa grande no traba mover la vista).
    const somb = marcando || pieza ? null : ev.target.closest('[data-sombra]');
    const k = somb ? Number(somb.dataset.sombra) : null;
    if (somb && seleccion?.tipo === 'sombra' && seleccion.i === k) {
      gesto = { tipo: 'moverSombra', k, p0: { x: p.x, y: plano().largo - p.y }, orig: structuredClone(plano().sombras[k]), x0: ev.clientX, y0: ev.clientY, movio: false };
      return;
    }
    if (pieza) {
      const sel = { tipo: pieza.dataset.mover, s: Number(pieza.dataset.s), i: Number(pieza.dataset.i) };
      const obj = objeto(sel);
      gesto = { tipo: 'mover', sel, dx: obj.x - p.x, dy: obj.y - (plano().largo - p.y), x0: ev.clientX, y0: ev.clientY, movio: false };
    } else gesto = { tipo: 'mirar', x0: ev.clientX, y0: ev.clientY, vista: { ...vista }, movio: false, sombra: k };
  }
  function alMover(ev) {
    if (!punteros.has(ev.pointerId) || !gesto) return;
    punteros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const porPixel = vista.w / ctx.svg.clientWidth;
    if (gesto.tipo === 'pellizco' && punteros.size === 2) {
      const [a, b] = [...punteros.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const k = gesto.dist / d, v = gesto.vista;
      const w = Math.min(500, Math.max(2, v.w * k));
      vista = { x: v.x + (v.w - w) / 2, y: v.y + (v.h - v.h * w / v.w) / 2, w, h: v.h * w / v.w };
      return repintar();
    }
    const mx = ev.clientX - gesto.x0, my = ev.clientY - gesto.y0;
    if (Math.hypot(mx, my) > 4) gesto.movio = true;
    if (!gesto.movio) return;
    if (gesto.tipo === 'mirar') {
      vista = { ...gesto.vista, x: gesto.vista.x - mx * porPixel, y: gesto.vista.y - my * porPixel };
      return repintar();
    }
    if (gesto.tipo === 'moverSombra') {
      const p = aSVG(ev), t = plano(), o = t.sombras[gesto.k], v = gesto.orig;
      const dx = p.x - gesto.p0.x, dy = (t.largo - p.y) - gesto.p0.y;
      const r2 = n => Math.round(n * 100) / 100;
      if (v.puntos) o.puntos = v.puntos.map(q => ({ x: r2(q.x + dx), y: r2(q.y + dy) }));
      else { o.x = r2(v.x + dx); o.y = r2(v.y + dy); }
      return repintar();
    }
    if (gesto.tipo === 'mover') {
      const p = aSVG(ev), t = plano();
      const obj = objeto(gesto.sel);
      obj.x = r1(Math.min(t.ancho, Math.max(0, p.x + gesto.dx)));
      obj.y = r1(Math.min(t.largo, Math.max(0, (t.largo - p.y) + gesto.dy)));
      seleccion = gesto.sel;
      repintar();
    }
  }
  function alSoltar(ev) {
    punteros.delete(ev.pointerId);
    if (!gesto) return;
    if (gesto.tipo === 'mover') {
      if (!gesto.movio) seleccion = gesto.sel;
      ctx.alCambiar(gesto.movio);
      pintar();
    } else if (gesto.tipo === 'moverSombra') {
      if (gesto.movio) ctx.alCambiar(false);
      pintar();
    } else if (gesto.tipo === 'mirar' && !gesto.movio && marcando) {
      const p = aSVG(ev), m = marcando;
      if (m.puntos.length === m.n) m.puntos = [];
      m.puntos.push({ x: p.x, y: plano().largo - p.y });
      pintar();
      if (m.puntos.length === m.n) m.alTerminar(...m.puntos);
      else m.alMarcar?.(m.puntos.length);
    } else if (gesto.tipo === 'mirar' && !gesto.movio) {
      seleccion = gesto.sombra != null ? { tipo: 'sombra', i: gesto.sombra } : null;
      pintar();
    }
    if (punteros.size === 0) gesto = null;
  }

  // ---------- Arranque ----------
  function iniciar(opciones) {
    const primera = !ctx;
    ctx = opciones;
    vista = null;
    seleccion = null;
    marcando = null;
    if (soloSector != null && soloSector >= ctx.obra.sectores.length) soloSector = null;
    if (primera) {
      const svg = ctx.svg;
      svg.addEventListener('pointerdown', alBajar);
      svg.addEventListener('pointermove', alMover);
      svg.addEventListener('pointerup', alSoltar);
      svg.addEventListener('pointercancel', alSoltar);
      svg.addEventListener('wheel', ev => { ev.preventDefault(); const p = aSVG(ev); zoom(ev.deltaY > 0 ? 1.15 : 1 / 1.15, p.x, p.y); }, { passive: false });
      ctx.botones.addEventListener('click', ev => {
        const b = ev.target.closest('[data-zoom]');
        if (!b) return;
        if (b.dataset.zoom === 'ajustar') { ajustar(); pintar(); } else zoom(b.dataset.zoom === 'mas' ? 1 / 1.4 : 1.4);
      });
      ctx.seleccion.addEventListener('input', ev => {
        const campo = ev.target.dataset.sel;
        if (!campo || !seleccion) return;
        const v = parseFloat(String(ev.target.value).replace(',', '.'));
        if (!Number.isFinite(v)) return;
        const obj = objeto(seleccion), t = plano();
        if (campo === 'giro') obj.giro = ((v % 360) + 360) % 360;
        if (campo === 'x') obj.x = r1(Math.min(t.ancho, Math.max(0, v)));
        if (campo === 'y') obj.y = r1(Math.min(t.largo, Math.max(0, v)));
        ctx.alCambiar(campo !== 'giro');
        const foco = campo; pintar();
        ctx.seleccion.querySelector(`[data-sel=${foco}]`)?.focus();
      });
      ctx.seleccion.addEventListener('click', ev => {
        if (seleccion?.tipo === 'sombra') {
          const o = plano().sombras[seleccion.i];
          const alt = ev.target.closest('[data-altura]');
          if (alt) {
            o.altura = Number(alt.dataset.altura);
            if (o.tipo === 'arbol') o.radio = S.COPA[o.altura] ?? o.radio;
            ctx.alCambiar(false); pintar();
          }
          const quitar = ev.target.closest('[data-quitar-sombra]');
          if (quitar && !quitar.dataset.confirmar) { quitar.dataset.confirmar = '1'; quitar.textContent = 'Tocá de nuevo para quitar'; }
          else if (quitar) { plano().sombras.splice(seleccion.i, 1); seleccion = null; ctx.alCambiar(false); pintar(); }
          return;
        }
        const b = ev.target.closest('[data-girar]');
        if (!b || !seleccion) return;
        const obj = objeto(seleccion);
        obj.giro = (((obj.giro || 0) + Number(b.dataset.girar)) % 360 + 360) % 360;
        ctx.alCambiar(false);
        pintar();
      });
      ctx.filtro.addEventListener('click', ev => {
        const b = ev.target.closest('[data-filtro]');
        if (!b) return;
        soloSector = b.dataset.filtro === '' ? null : Number(b.dataset.filtro);
        pintarFiltro(); pintar();
      });
    }
    pintarFiltro();
    ajustar(); pintar();
    // Cuando la pantalla terminó de acomodarse, se vuelve a encuadrar con el tamaño real.
    requestAnimationFrame(() => { ajustar(); pintar(); });
  }
  function pintarFiltro() {
    ctx.filtro.innerHTML = `<button type="button" data-filtro="" class="${soloSector == null ? 'activo' : ''}">Todos</button>` +
      ctx.obra.sectores.map((s, k) => `<button type="button" data-filtro="${k}" class="${soloSector === k ? 'activo' : ''}"><i style="background:${colorSector(k)}"></i>${(s.nombre || `Sector ${k + 1}`).replace(/[<>&]/g, '')}</button>`).join('');
  }

  // Modo marcar: los próximos n toques en el plano marcan puntos; arrastrar sigue moviendo la vista.
  function marcar({ n, etiquetas, alMarcar, alTerminar }) { marcando = { n, etiquetas, puntos: [], alMarcar, alTerminar }; seleccion = null; pintar(); }
  function dejarDeMarcar() { marcando = null; pintar(); }
  // Modo escalar: los dos próximos toques marcan A y B.
  const calibrar = (alMarcar, alTerminar) => marcar({ n: 2, etiquetas: ['A', 'B'], alMarcar, alTerminar });

  global.PLANO = { iniciar, pintar: () => ctx && pintar(), colorSector, soloSector: () => soloSector, calibrar, dejarDeCalibrar: dejarDeMarcar,
    marcar, dejarDeMarcar, elegirSombra: i => { seleccion = { tipo: 'sombra', i }; pintar(); },
    mapaSol: () => ctx ? mapaSol() : null,
    solPorSector: () => ctx ? S.porSector(mapaSol(), plano(), ctx.aspersores(), G.riega) : [],
    reencuadrar: () => { if (ctx) { ajustar(); pintar(); } },
    coberturaActual: () => ctx ? G.cobertura(plano(), ctx.aspersores()) : null };
})(typeof window !== 'undefined' ? window : globalThis);
