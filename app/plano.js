// Plano de la obra: terreno, aspersores con su abanico real, válvulas, fuente, caños, cobertura y lado del sol.
// Se arrastra con el dedo (aspersores, válvulas, fuente, codos y esquinas de zonas), se gira tocando un aspersor y se hace zoom con dos dedos.
// Zonas a regar dibujadas sobre la foto (se escala con la medida real de un lado); aspersores que se agregan tocando el plano.
// Dibuja en SVG con coordenadas en metros. Usa GEOMETRIA (app/geometria.js) y SOL (app/sol.js).

(function (global) {
  const G = global.GEOMETRIA, S = global.SOL, O = () => global.OBRA;
  const NS = 'http://www.w3.org/2000/svg';
  const COLORES = ['#0a9ae9', '#8b5cf6', '#f97316', '#14b8a6', '#e11d48', '#ca8a04', '#2563eb', '#58a003'];
  const colorSector = k => COLORES[k % COLORES.length];
  // El aspersor elegido (el que se mueve, se gira o se le abre el arco) va en fucsia: no se confunde con los celestes
  const ELEGIDO = '#EC008C';
  const r1 = v => Math.round(v * 10) / 10;

  let ctx = null;        // { obra, aspersores(), alCambiar(), contenedor, ... }
  let vista = null;      // viewBox actual { x, y, w, h } en metros (y del SVG, hacia abajo)
  let seleccion = null;  // { tipo: 'asp'|'valvula'|'fuente'|'codo'|'zona'|'vertice', s, i }
  let soloSector = null; // índice de sector a mostrar, o null para todos
  let cuadro = 0;
  let marcando = null;   // { tipo, n, etiquetas, puntos: [{x, y}], alMarcar(n), alTerminar(...puntos) } mientras se marcan puntos con toques
  let midiendo = null;   // { zona, lado } o { esperando: true }: elegir el lado de una zona que se conoce, para escalar
  let editandoZona = null; // índice de la zona que se está editando (las demás quedan fijas)
  let ultimoSector = null; // sector con el que se trabajó último (para "+ Aspersor")
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
      const [r, gr, b, al] = n === G.FUERA ? [0, 0, 0, 0] : n === 0 ? [225, 29, 72, 110] : n === 1 ? [234, 179, 8, 80] : [10, 154, 233, 28];
      img.data[k] = r; img.data[k + 1] = gr; img.data[k + 2] = b; img.data[k + 3] = al;
    }
    g.putImageData(img, 0, 0);
    return lienzo.toDataURL();
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
    const P = p => `${p.x},${Y(p.y)}`;
    const zonas = t.zonas || [];
    // Zonas a regar: lo de afuera se oscurece; la cobertura y el sol se pintan solo adentro
    let recorte = {};
    if (zonas.length) {
      const clip = el('clipPath', { id: 'clip-zonas' }, el('defs', {}, svg));
      for (const z of zonas) el('polygon', { points: z.map(P).join(' ') }, clip);
      recorte = { 'clip-path': 'url(#clip-zonas)' };
      const fuera = `M ${vista.x} ${vista.y} h ${vista.w} v ${vista.h} h ${-vista.w} Z ` + zonas.map(z => `M ${z.map(P).join(' L ')} Z`).join(' ');
      el('path', { d: fuera, 'fill-rule': 'evenodd', class: 'fuera-zona' }, svg);
    }
    // Cobertura
    let cob = null;
    if (t.verCobertura && asps.length) {
      cob = G.cobertura(t, asps, Math.max(0.1, Math.min(0.25, Math.max(t.ancho, t.largo) / 240)), zonas);
      el('image', { href: imagenCobertura(cob), x: 0, y: 0, width: t.ancho, height: t.largo, preserveAspectRatio: 'none', class: t.fondo ? 'cobertura sobre-fondo' : 'cobertura' }, svg);
    }
    // Borde de cada zona (se toca el borde para elegirla). La zona queda fija: las esquinas y las medidas de los
    // lados aparecen solo con "Editar zona" (o mientras se elige el lado que se conoce).
    zonas.forEach((z, k) => {
      const elegida = editandoZona === k;
      el('polygon', { points: z.map(P).join(' '), 'stroke-width': 2.5 * escala, class: `zona ${elegida || (seleccion?.tipo === 'zona' && seleccion.s === k) ? 'elegida' : ''}` }, svg);
      el('polygon', { points: z.map(P).join(' '), 'stroke-width': 16 * escala, 'data-zona': k, class: 'zona-tocar' }, svg);
      if (midiendo?.zona === k) {
        const a = z[midiendo.lado], b = z[(midiendo.lado + 1) % z.length];
        el('line', { x1: a.x, y1: Y(a.y), x2: b.x, y2: Y(b.y), 'stroke-width': 6 * escala, class: 'lado-elegido' }, svg);
      }
      if (elegida || midiendo) z.forEach((a, i) => {
        const b = z[(i + 1) % z.length];
        const txt = el('text', { x: (a.x + b.x) / 2, y: Y((a.y + b.y) / 2), 'font-size': 11 * escala, 'stroke-width': 3 * escala, class: 'texto-lado' }, svg);
        txt.textContent = `${fmt1(Math.hypot(b.x - a.x, b.y - a.y))} m`;
      });
      if (elegida) z.forEach((p, i) => {
        const g = el('g', { 'data-mover': 'vertice', 'data-s': k, 'data-i': i, class: 'pieza' }, svg);
        el('circle', { cx: p.x, cy: Y(p.y), r: 14 * escala, class: 'tocar' }, g);
        el('circle', { cx: p.x, cy: Y(p.y), r: 5 * escala, 'stroke-width': 1.5 * escala, class: 'vertice' }, g);
      });
    });
    // Sol: degradé suave del lado norte (más sol) al lado sur (menos sol), según hacia dónde está el norte
    if (t.verSol) {
      const d = S.degradeSol(t, t.norte || 0);
      const grad = el('linearGradient', { id: 'degrade-sol', gradientUnits: 'userSpaceOnUse', x1: d.norte.x, y1: Y(d.norte.y), x2: d.sur.x, y2: Y(d.sur.y) }, el('defs', {}, svg));
      el('stop', { offset: 0, 'stop-color': '#facc15', 'stop-opacity': 0.5 }, grad);
      el('stop', { offset: 1, 'stop-color': '#94a3b8', 'stop-opacity': 0.35 }, grad);
      el('rect', { x: 0, y: 0, width: t.ancho, height: t.largo, fill: 'url(#degrade-sol)', class: 'capa-sol', ...recorte }, svg);
    }
    // Abanicos
    const abanicos = el('g', {}, svg);
    const esElegido = a => seleccion?.tipo === 'asp' && seleccion.s === a.s && seleccion.i === a.i;
    for (const a of asps) {
      const [tag, attrs] = forma(a);
      if (esElegido(a)) continue;   // el elegido se dibuja al final, encima de los demás
      el(tag, { ...attrs, fill: colorSector(a.s), 'fill-opacity': t.verCobertura ? 0.08 : 0.18, stroke: colorSector(a.s), 'stroke-width': 1.2 * escala, 'stroke-opacity': 0.8 }, abanicos);
    }
    const abanicoElegido = asps.find(esElegido);
    if (abanicoElegido) {
      const [tag, attrs] = forma(abanicoElegido);
      el(tag, { ...attrs, fill: ELEGIDO, 'fill-opacity': 0.28, stroke: ELEGIDO, 'stroke-width': 2.5 * escala }, abanicos);
    }
    // Caños: las válvulas van juntas a la salida de la bomba; de cada una sale el caño de su sector. Con el caño
    // dibujado, cada tramo se ve con el grosor de su diámetro (escalonado: más grueso al salir) y cada aspersor
    // tira su manguera recta hasta el caño. Sin dibujar, el caño pasa por los aspersores en orden.
    O().ubicarValvulas(ctx.obra);
    const sectores = ctx.obra.sectores;
    const canos = el('g', { class: 'canos' }, svg);
    const rf = 9 * escala;
    const guiones = { 'stroke-dasharray': `${6 * escala} ${4 * escala}`, fill: 'none' };
    const grosor = nominal => Math.max(2, nominal / 10) * escala;   // 32 mm → 3,2 px; 63 mm → 6,3 px
    sectores.forEach((s, k) => {
      if (soloSector != null && k !== soloSector) return;
      if (!t.bombaUbicada) return;   // hasta que se marque la bomba no hay de dónde sacar caños
      const ubicados = s.aspersores.filter(a => a.x != null && a.y != null);
      const diametros = O().diametrosDelSector(ctx.obra, s);
      if (!O().tieneRamal(s)) return;   // nunca una manguera a la bomba: hasta que se dibuje el caño, no hay conexiones
      const linea = [s.valvulaPos, ...s.ramal], largo = G.largoDeLinea(linea);
      el('polyline', { points: linea.map(P).join(' '), 'stroke-width': 30 * escala, 'data-cano': k, class: 'cano-tocar' }, canos);
      const conexiones = G.conexionesAlRamal(s.valvulaPos, s.ramal, ubicados);
      // Tramos del mismo diámetro: desde la válvula (o el último cambio) hasta la conexión donde cambia
      let desde = 0, recorrido = 0;
      const cortes = [];
      const porTramo = O().tramosDelRamal(s);
      if (porTramo) for (const tr of porTramo) {
        if (cortes.length && cortes.at(-1).d === tr.nominal) cortes.at(-1).hasta = tr.hasta;
        else cortes.push({ desde: tr.desde, hasta: tr.hasta, d: tr.nominal });
      }
      if (!porTramo) conexiones.forEach((c, n) => {
        recorrido += c.tramo;
        const d = diametros[n] ?? diametros.at(-1), siguiente = diametros[n + 1];
        if (siguiente != null && siguiente !== d) { cortes.push({ desde, hasta: recorrido, d }); desde = recorrido; }
      });
      if (!porTramo) cortes.push({ desde, hasta: largo, d: diametros[Math.max(0, conexiones.length - 1)] ?? diametros.at(-1) ?? 32 });
      for (const tr of cortes) {
        const pts = G.subLinea(linea, tr.desde, tr.hasta);
        if (pts.length < 2) continue;
        el('polyline', { points: pts.map(P).join(' '), stroke: '#3F4652', 'stroke-width': grosor(tr.d) + 2 * escala, fill: 'none', 'stroke-linejoin': 'round', class: 'ramal', 'data-cano': k }, canos);
        el('polyline', { points: pts.map(P).join(' '), stroke: colorSector(k), 'stroke-width': 1.2 * escala, fill: 'none', class: 'ramal', 'data-cano': k }, canos);   // tocar el caño (también justo sobre la línea) abre su medida
        const medio = G.subLinea(linea, (tr.desde + tr.hasta) / 2, (tr.desde + tr.hasta) / 2)[0] || pts[0];   // etiqueta en la mitad del tramo
        const txt = el('text', { x: medio.x, y: Y(medio.y) - 6 * escala, 'font-size': 10 * escala, 'stroke-width': 3 * escala, class: 'texto-diametro' }, canos);
        txt.textContent = `${tr.d} mm`;
      }
      for (const c of conexiones) {
        const a = ubicados[c.i];
        el('line', { x1: a.x, y1: Y(a.y), x2: c.punto.x, y2: Y(c.punto.y), stroke: colorSector(k), 'stroke-width': 1.5 * escala, class: 'manguera' }, canos);
        el('circle', { cx: c.punto.x, cy: Y(c.punto.y), r: 2.5 * escala, fill: colorSector(k) }, canos);
      }
      // Codos y final del caño: se arrastran para acomodar el recorrido
      s.ramal.forEach((p, i) => {
        const g = el('g', { 'data-mover': 'codo', 'data-s': k, 'data-i': i, class: `pieza ${seleccion?.tipo === 'codo' && seleccion.s === k && seleccion.i === i ? 'elegida' : ''}` }, canos);
        el('circle', { cx: p.x, cy: Y(p.y), r: rf * 1.6, class: 'tocar' }, g);
        el('rect', { x: p.x - rf * 0.45, y: Y(p.y) - rf * 0.45, width: rf * 0.9, height: rf * 0.9, stroke: colorSector(k), 'stroke-width': 1.5 * escala, class: 'codo' }, g);
      });
    });
    // Bomba (o canilla) con su nombre; se arrastra y las válvulas van con ella
    const f = el('g', { 'data-mover': 'fuente', class: `pieza ${seleccion?.tipo === 'fuente' ? 'elegida' : ''}`, ...(t.bombaUbicada ? {} : { display: 'none' }) }, svg);
    el('circle', { cx: t.fuente.x, cy: Y(t.fuente.y), r: rf * 2.2, class: 'tocar' }, f);
    el('circle', { cx: t.fuente.x, cy: Y(t.fuente.y), r: rf, class: 'fuente' }, f);
    const etiqueta = el('text', { x: t.fuente.x, y: Y(t.fuente.y) + rf * 2.4, 'font-size': rf * 1.2, 'stroke-width': 3 * escala, class: 'texto-fuente' }, f);
    etiqueta.textContent = ctx.obra.fuente.tipo === 'bomba' ? 'Bomba' : 'Canilla';
    // Válvulas: a la salida de la bomba, con el número de su sector (se tocan para dibujar el caño del sector)
    sectores.forEach((s, k) => {
      if (soloSector != null && k !== soloSector) return;
      if (!t.bombaUbicada) return;
      const v = el('g', { 'data-mover': 'fuente', class: `pieza ${seleccion?.tipo === 'fuente' ? 'elegida' : ''}` }, svg);
      el('circle', { cx: s.valvulaPos.x, cy: Y(s.valvulaPos.y), r: rf * 1.3, class: 'tocar' }, v);
      el('rect', { x: s.valvulaPos.x - rf * 0.7, y: Y(s.valvulaPos.y) - rf * 0.7, width: rf * 1.4, height: rf * 1.4, fill: colorSector(k), class: 'valvula' }, v);
      const n = el('text', { x: s.valvulaPos.x, y: Y(s.valvulaPos.y) + rf * 0.4, 'font-size': rf * 1, class: 'numero-plano' }, v);
      n.textContent = k + 1;
    });
    // Puntos marcados con toques (para escalar con una medida conocida)
    svg.classList.toggle('calibrando', !!marcando);
    if (marcando) {
      const rc = 6 * escala;
      const linea = marcando.desde ? [marcando.desde, ...marcando.puntos] : marcando.puntos;
      if (marcando.tipo === 'zona' && linea.length > 2)
        el('polygon', { points: linea.map(P).join(' '), 'stroke-width': 2.5 * escala, class: 'linea-calibrar zona-nueva' }, svg);
      else if (linea.length > 1)
        el('polyline', { points: linea.map(P).join(' '), fill: 'none', 'stroke-width': 2.5 * escala, class: 'linea-calibrar' }, svg);
      // Cada punto marcado se puede arrastrar para corregirlo (sin mover el mapa); la primera esquina cierra la zona
      marcando.puntos.forEach((p, k) => {
        const g = el('g', { 'data-marca': k, class: 'pieza' }, svg);
        el('circle', { cx: p.x, cy: Y(p.y), r: rc * 3, class: 'tocar' }, g);
        el('circle', { cx: p.x, cy: Y(p.y), r: rc, 'stroke-width': 1.5 * escala, class: `marca-calibrar ${k === 0 && marcando.tipo === 'zona' && marcando.puntos.length > 2 ? 'cerrar' : ''}` }, g);
        const txt = el('text', { x: p.x + rc * 1.4, y: Y(p.y) - rc * 1.2, 'font-size': rc * 3, 'stroke-width': 3 * escala, class: 'texto-calibrar' }, g);
        txt.textContent = marcando.etiquetas ? marcando.etiquetas[k] : k + 1;
      });
    }
    // Aspersores (encima de todo)
    for (const a of asps) {
      const g = el('g', { 'data-mover': 'asp', 'data-s': a.s, 'data-i': a.i, class: `pieza ${seleccion?.tipo === 'asp' && seleccion.s === a.s && seleccion.i === a.i ? 'elegida' : ''}` }, svg);
      el('circle', { cx: a.x, cy: Y(a.y), r: rf * 2.2, class: 'tocar' }, g);
      el('circle', { cx: a.x, cy: Y(a.y), r: esElegido(a) ? rf * 1.25 : rf, fill: esElegido(a) ? ELEGIDO : colorSector(a.s), class: 'cabeza' }, g);
      const txt = el('text', { x: a.x, y: Y(a.y) + rf * 0.4, 'font-size': rf * 1.15, class: 'numero-plano' }, g);
      txt.textContent = a.num ?? a.i + 1;
    }
    // Aspersor elegido: agarraderas sobre el borde del abanico. La del medio lo gira; las de las puntas abren o
    // cierran el arco (parejo de los dos lados). El largo no cambia: es el alcance real según la presión.
    const elegido = seleccion?.tipo === 'asp' && !marcando ? asps.find(a => a.s === seleccion.s && a.i === seleccion.i) : null;
    if (elegido && !elegido.franja && !trabado()) {   // con el plano trabado no hay agarraderas
      const abriendo = gesto?.tipo === 'asa' && gesto.asa !== 'girar' && gesto.movio;
      const arco = abriendo ? gesto.arco : elegido.arco;
      const giro = abriendo ? gesto.giro : elegido.giro;
      if (abriendo) {
        const [tag, attrs] = forma({ ...elegido, arco, giro });
        el(tag, { ...attrs, fill: ELEGIDO, 'fill-opacity': 0.25, stroke: ELEGIDO, 'stroke-width': 2 * escala, 'stroke-dasharray': `${4 * escala} ${3 * escala}` }, svg);
      }
      const punto = rumbo => ({ x: elegido.x + elegido.radio * Math.sin(rumbo * Math.PI / 180), y: elegido.y + elegido.radio * Math.cos(rumbo * Math.PI / 180) });
      const asa = (p, tipo, clase) => {
        const g = el('g', { 'data-asa': tipo, class: 'pieza' }, svg);
        el('circle', { cx: p.x, cy: Y(p.y), r: rf * 2, class: 'tocar' }, g);
        el('circle', { cx: p.x, cy: Y(p.y), r: rf * 0.75, 'stroke-width': 1.5 * escala, class: `asa ${clase}` }, g);
      };
      asa(punto(giro), 'girar', 'asa-girar');
      if (arco < 360) { asa(punto(giro - arco / 2), 'arco-izq', 'asa-arco'); asa(punto(giro + arco / 2), 'arco-der', 'asa-arco'); }
      else asa(punto(giro + 180), 'arco-der', 'asa-arco');
      const txt = el('text', { x: punto(giro).x, y: Y(punto(giro).y) - rf * 1.4, 'font-size': rf * 1.3, 'stroke-width': 3 * escala, class: 'texto-diametro' }, svg);
      txt.textContent = `${Math.round(arco)}°`;
    }
    if (consulta?.marca) {
      // La parte de la que habla la idea, pintada de un color que no se usa en el plano
      const pc = consulta.paso || { x: 0.35, y: 0.35 }, g = el('g', { class: 'marca-sugerida' }, svg);
      for (const [x, y] of consulta.marca.celdas || []) el('rect', { x: x - pc.x / 2, y: Y(y) - pc.y / 2, width: pc.x, height: pc.y }, g);
      const p = consulta.marca.punto;
      if (p) el('circle', { cx: p.x, cy: Y(p.y), r: Math.max(0.5, 12 * escala), class: 'marca-sugerida-borde', 'stroke-width': 3 * escala }, svg);
    }
    if (ctx.rosa) ctx.rosa.style.transform = `rotate(${t.norte || 0}deg)`;
    const candado = ctx.botones?.querySelector('[data-zoom="candado"]');
    if (candado) { candado.textContent = trabado() ? '🔒' : '🔓'; candado.classList.toggle('activo', trabado()); candado.setAttribute('aria-label', trabado() ? 'Destrabar el plano' : 'Trabar el plano'); }
    pintarDatos(cob, t.verSol);
  }

  const pct = v => `<b>${v.toFixed(0)} %</b>`;
  function pintarDatos(cob, sol) {
    const t = plano();
    let html = '';
    if (cob) html = `<span class="dato seco">${pct(cob.seco)} seco</span><span class="dato uno">${pct(cob.uno)} un solo aspersor</span><span class="dato bien">${pct(cob.bien)} bien cubierto</span>`;
    if (sol) html = `<p class="ayuda">El sol pasa por el norte: el lado de ${S.ladoDelPlano(t.norte || 0)} del plano recibe más sol y el de ${S.ladoDelPlano((t.norte || 0) + 180)}, menos. Es orientativo: lo que queda justo al sur de una casa, un muro o un árbol tiene más sombra.</p>`;
    if (!sol && ctx.aspersores().length >= 2) html += pintarConsulta();
    ctx.estadisticas.innerHTML = html;
    const piezas = '▲ fuente · ■ válvula · línea gris: caño · línea fina: manguera · fucsia: el aspersor elegido · □ codo';
    if (ctx.leyenda) ctx.leyenda.innerHTML = sol ? `<i class="sol"></i> más sol (norte) <i class="menos-sol"></i> menos sol (sur) · ${piezas}`
      : t.verCobertura ? `<i class="seco"></i> seco <i class="uno"></i> un solo aspersor <i class="bien"></i> bien cubierto (dos o más) · ${piezas}` : piezas;
    pintarAcciones();
    pintarSeleccion();
  }

  // Botones de arriba del plano: agregar aspersores, dibujar la zona a regar y los aspersores que faltan ubicar.
  function pintarAcciones() {
    if (!ctx.acciones) return;
    const t = plano(), ocupado = !!(marcando || midiendo);
    const faltan = [];
    ctx.obra.sectores.forEach((s, k) => {
      if (soloSector != null && k !== soloSector) return;
      s.aspersores.forEach((a, i) => { if (a.x == null || a.y == null) faltan.push({ k, i, a }); });
    });
    const sinBomba = !t.bombaUbicada;
    const ks = soloSector ?? (ctx.obra.sectores.length === 1 ? 0 : ultimoSector);
    const sectorTxt = ks != null && ctx.obra.sectores[ks] ? nombre(ks).replace(/[<>&]/g, '') : null;
    ctx.acciones.innerHTML = (sinBomba ? `<button type="button" class="principal lleno ancho" data-plano="bomba" ${ocupado ? 'disabled' : ''}>Ubicar ${nombreFuente()}</button>
        <p class="ayuda">Primero marcá dónde va ${nombreFuente()}: de ahí salen los caños de los sectores.</p>` : '') + `<div class="botones-plano">
        <button type="button" class="boton" data-plano="aspersores" ${ocupado || sinBomba ? 'disabled' : ''}>+ Aspersor</button>
        <button type="button" class="boton" data-plano="cano" ${ocupado || sinBomba ? 'disabled' : ''}>Caño ${sectorTxt ? 'de ' + sectorTxt : 'del sector'}</button>
        <button type="button" class="boton" data-plano="sector" ${ocupado ? 'disabled' : ''}>+ Sector</button>
        <button type="button" class="boton" data-plano="zona" ${ocupado ? 'disabled' : ''}>${(t.zonas || []).length ? '+ Otra zona' : 'Dibujar zona'}</button>
      </div>` + (faltan.length ? `<p class="ayuda">Sin ubicar en el plano (tocá uno y después tocá dónde va):</p>
      <div class="filtro sin-ubicar">${faltan.map(f => `<button type="button" data-ubicar="${f.k},${f.i}" class="${marcando?.tipo === 'ubicar' && marcando.s === f.k && marcando.i === f.i ? 'activo' : ''}">
        <i style="background:${colorSector(f.k)}"></i>${nombre(f.k).replace(/[<>&]/g, '')} · ${O().numero(ctx.obra.sectores[f.k], f.i)}: ${f.a.boquilla || ''} ${f.a.arco ? f.a.arco + '°' : ''}</button>`).join('')}</div>` : '');
  }

  // Barra flotante sobre el plano mientras se marca algo: la instrucción corta y los botones siempre a la vista.
  function pintarFlotante() {
    const f = ctx.flotante;
    if (!f) return;
    const b = (attr, valor, texto, clase = '', off = false) => `<button type="button" class="chico ${clase}" ${attr}="${valor}" ${off ? 'disabled' : ''}>${texto}</button>`;
    const n = marcando?.puntos?.length || 0;
    let texto = '', botones = [];
    if (marcando?.tipo === 'zona') {
      texto = n < 3 ? `Tocá cada esquina (${n})` : `${n} esquinas · tocá la 1 para cerrar`;
      botones = [b('data-modo-accion', 'deshacer', 'Deshacer', '', !n), b('data-modo-accion', 'zona-listo', 'Listo', 'activo', n < 3), b('data-modo-accion', 'cancelar', 'Cancelar')];
    } else if (marcando?.tipo === 'ramal') {
      texto = `Tocá por dónde va el caño (${n})`;
      botones = [b('data-ramal', 'deshacer', 'Deshacer', '', !n), b('data-ramal', 'listo', 'Listo', 'activo', !n), b('data-ramal', 'cancelar', 'Cancelar')];
    } else if (marcando?.tipo === 'aspersores' && marcando.copia) {
      texto = `Tocá dónde va cada copia (${marcando.puestos})`;
      botones = [b('data-modo-accion', 'cancelar', 'Listo', 'activo')];
    } else if (marcando?.tipo === 'aspersores') {
      texto = 'Tocá dónde va el aspersor';
      botones = [b('data-modo-accion', 'cancelar', 'Cancelar')];
    } else if (marcando?.tipo === 'bomba') {
      texto = `Tocá dónde va ${nombreFuente()}`;
      botones = [b('data-modo-accion', 'cancelar', 'Cancelar')];
    } else if (marcando?.tipo === 'ubicar') {
      texto = 'Tocá dónde va el aspersor';
      botones = [b('data-modo-accion', 'cancelar', 'Cancelar')];
    } else if (midiendo?.esperando) {
      texto = 'Tocá el lado que conocés';
      botones = [b('data-modo-accion', 'medir-cancelar', 'Ahora no')];
    } else if (midiendo) {
      texto = 'Medida real del lado amarillo:';
      botones = ['<input type="text" inputmode="decimal" autocomplete="off" step="0.1" min="0.1" placeholder="m" data-medida-real>', b('data-modo-accion', 'medir-aplicar', 'Aplicar', 'activo'), b('data-modo-accion', 'medir-cancelar', 'Ahora no')];
    }
    f.hidden = !texto;
    f.innerHTML = texto ? `<span>${texto}</span><div>${botones.join('')}</div>` : '';
  }

  // Panel del elemento tocado: posición exacta y giro.
  function pintarSeleccion() {
    pintarFlotante();
    const caja = ctx.seleccion;
    if (marcando?.tipo === 'ramal') {
      const n = marcando.puntos.length;
      caja.innerHTML = `<p class="sel-titulo">Caño principal de ${nombre(marcando.s)}</p>
        <p class="ayuda">Tocá en el plano por dónde va el caño, empezando cerca de la válvula. Cada toque es un codo; el último es el final del caño (tapón). Arrastrar sigue moviendo la vista.</p>
        <p class="ayuda"><b>${n}</b> ${n === 1 ? 'punto marcado' : 'puntos marcados'}.</p>
        <div class="giros"><button type="button" class="chico activo" data-ramal="listo" ${n ? '' : 'disabled'}>Listo</button>
        <button type="button" class="chico" data-ramal="deshacer" ${n ? '' : 'disabled'}>Deshacer</button>
        <button type="button" class="chico" data-ramal="cancelar">Cancelar</button></div>`;
      return;
    }
    const botones = lista => `<div class="giros">${lista.map(([accion, texto, clase = '', off = false]) => `<button type="button" class="chico ${clase}" data-modo-accion="${accion}" ${off ? 'disabled' : ''}>${texto}</button>`).join('')}</div>`;
    if (marcando?.tipo === 'zona') {
      const n = marcando.puntos.length;
      caja.innerHTML = `<p class="sel-titulo">Zona a regar</p>
        <p class="ayuda">Tocá en el plano cada esquina de la parte que se riega (la tierra o el pasto), una después de la otra, dando la vuelta. Arrastrar sigue moviendo la vista.</p>
        <p class="ayuda"><b>${n}</b> ${n === 1 ? 'esquina marcada' : 'esquinas marcadas'}${n < 3 ? ' (hacen falta por lo menos 3)' : ''}.</p>
        ${botones([['zona-listo', 'Listo', 'activo', n < 3], ['deshacer', 'Deshacer', '', !n], ['cancelar', 'Cancelar']])}`;
      return;
    }
    if (marcando?.tipo === 'aspersores' && marcando.copia) {
      caja.innerHTML = `<p class="sel-titulo">Duplicar aspersor en ${nombre(marcando.s)}</p>
        <p class="ayuda">Cada toque en el plano pone una copia igual (misma boquilla, arco y dirección). Van ${marcando.puestos}. Cuando termines, Listo.</p>
        ${botones([['cancelar', 'Listo', 'activo']])}`;
      return;
    }
    if (marcando?.tipo === 'aspersores') {
      caja.innerHTML = `<p class="sel-titulo">Agregar un aspersor a ${nombre(marcando.s)}</p>
        <p class="ayuda">Tocá en el plano dónde va. Sale con la misma tobera que el último y queda elegido para acomodarlo, girarlo y abrirle el arco.</p>
        ${botones([['cancelar', 'Cancelar']])}`;
      return;
    }
    if (marcando?.tipo === 'elegir-sector') {
      caja.innerHTML = `<p class="sel-titulo">¿En qué sector va el aspersor?</p>
        <div class="giros">${ctx.obra.sectores.map((s, k) => `<button type="button" class="chico" data-sector-nuevo="${k}">${nombre(k).replace(/[<>&]/g, '')}</button>`).join('')}</div>
        ${botones([['cancelar', 'Cancelar']])}`;
      return;
    }
    if (marcando?.tipo === 'ubicar') {
      caja.innerHTML = `<p class="sel-titulo">Ubicar el aspersor ${O().numero(ctx.obra.sectores[marcando.s], marcando.i)} de ${nombre(marcando.s)}</p>
        <p class="ayuda">Tocá en el plano dónde va.</p>${botones([['cancelar', 'Cancelar']])}`;
      return;
    }
    if (midiendo) {
      const z = midiendo.esperando ? null : plano().zonas[midiendo.zona];
      const largo = z && Math.hypot(z[(midiendo.lado + 1) % z.length].x - z[midiendo.lado].x, z[(midiendo.lado + 1) % z.length].y - z[midiendo.lado].y);
      caja.innerHTML = midiendo.esperando
        ? `<p class="sel-titulo">¿Qué lado conocés?</p><p class="ayuda">Tocá en el plano el lado de la zona que sabés cuánto mide (por ejemplo, el frente). Todo se va a escalar con esa medida.</p>
          ${botones([['medir-cancelar', 'Ahora no']])}`
        : `<p class="sel-titulo">Lado elegido (marcado en amarillo)</p>
          <p class="ayuda">En el plano mide ${fmt1(largo)} m. ¿Cuánto mide en la realidad?</p>
          ${ctx.flotante ? '<p class="ayuda">Escribí la medida en el recuadro que está justo debajo del plano, o tocá otro lado para cambiarlo.</p>' + botones([['medir-otro', 'Otro lado']]) : `<label>Medida real <span class="unidad">m</span><input type="text" inputmode="decimal" autocomplete="off" step="0.1" min="0.1" data-medida-real></label>
          ${botones([['medir-aplicar', 'Aplicar', 'activo'], ['medir-otro', 'Otro lado'], ['medir-cancelar', 'Ahora no']])}`}
          ${midiendo.error ? `<p class="ayuda aviso-arco">${midiendo.error}</p>` : ''}`;
      return;
    }
    if (!seleccion) {
      caja.innerHTML = `<p class="ayuda">${(plano().zonas || []).length ? '' : 'Empezá dibujando la zona a regar (botón de arriba del plano). '}Tocá un aspersor para girarlo, cambiarle el arco o quitarlo; arrastralo para moverlo. Tocá la válvula para dibujar el caño principal. Con dos dedos, zoom.</p>`;
      return;
    }
    if (seleccion.tipo === 'cano') {
      // Caño del sector: su medida (automático = escalonado, o un diámetro fijo)
      const s = ctx.obra.sectores[seleccion.s], l = s.lateral;
      const dms = Object.keys(global.RIEGO.CANOS[l.material].di).map(Number);
      const porTramo = O().tramosDelRamal(s);
      const op = (v, t) => `<button type="button" class="chico ${!porTramo && (v === 'auto' ? l.escalonado : !l.escalonado && l.nominal === v) ? 'activo' : ''}" data-diametro="${v}">${t}</button>`;
      const k = seleccion.tramo, n = s.ramal.length;
      const nombreTramo = k == null ? '' : k === 0 ? (n === 1 ? 'de la válvula al final' : 'de la válvula al codo 1') : k === n - 1 ? `del codo ${k} al final` : `del codo ${k} al codo ${k + 1}`;
      const linea = [s.valvulaPos, ...s.ramal];
      const largoTramo = k == null ? 0 : Math.hypot(linea[k + 1].x - linea[k].x, linea[k + 1].y - linea[k].y);
      const actual = porTramo?.[k]?.nominal;
      const opTramo = d => `<button type="button" class="chico ${actual === d ? 'activo' : ''}" data-diametro-tramo="${d}">${d} mm</button>`;
      caja.innerHTML = `<p class="sel-titulo">Caño de ${nombre(seleccion.s).replace(/[<>&]/g, '')}: ${fmt1(O().largoRamal(s))} m, ${O().codosRamal(s)} ${O().codosRamal(s) === 1 ? 'codo' : 'codos'}</p>
        ${k != null ? `<p class="etiqueta-campo">Este tramo (${nombreTramo}, ${fmt1(largoTramo)} m)</p>
        <div class="giros">${dms.map(opTramo).join('')}</div>
        <p class="ayuda">Donde cambia la medida va una cupla con buje de reducción (sale en el presupuesto).</p>` : ''}
        <p class="etiqueta-campo">Todo el caño</p>
        <div class="giros">${op('auto', 'Automático')}${dms.map(d => op(d, `${d} mm`)).join('')}</div>
        <p class="ayuda">Automático: sale grueso y se va achicando en los tirones largos, con cupla y buje en cada cambio.${porTramo ? ' Elegir acá borra las medidas por tramo.' : ''}</p>`;
      caja.innerHTML += `
        ${botones([['cano-dibujar', 'Dibujar de nuevo'], ['cano-borrar', 'Borrar caño', 'peligro']])}`;
      return;
    }
    if (seleccion.tipo === 'zona' || seleccion.tipo === 'vertice') {
      const z = plano().zonas[seleccion.s];
      caja.innerHTML = editandoZona === seleccion.s
        ? `<p class="sel-titulo">Editando la zona ${seleccion.s + 1}: ${fmt1(G.areaPoligono(z))} m²</p>
          <p class="ayuda">Arrastrá los puntitos de las esquinas para acomodarla. Las medidas de los lados están en el plano.</p>
          ${botones([['zona-terminar', 'Listo', 'activo'], ['medir', 'Escalar con un lado'], ...(seleccion.tipo === 'vertice' && z.length > 3 ? [['quitar-esquina', 'Quitar esta esquina']] : [])])}`
        : `<p class="sel-titulo">Zona a regar ${seleccion.s + 1}: ${fmt1(G.areaPoligono(z))} m²</p>
          <p class="ayuda">La zona y su medida quedan fijas para no moverlas sin querer.</p>
          ${botones([['editar-zona', 'Editar zona'], ['quitar-zona', 'Quitar zona', 'peligro']])}`;
      return;
    }
    const obj = objeto(seleccion);
    let titulo = ctx.obra.fuente.tipo === 'bomba' ? 'Bomba y válvulas' : 'Canilla y válvulas';
    let giro = '', arriba = '';
    if (seleccion.tipo === 'fuente') {
      // Un renglón por sector: su válvula está a la salida de la bomba y de ahí sale su caño
      const filas = ctx.obra.sectores.map((s, k) => {
        const tiene = O().tieneRamal(s);
        return `<div class="fila-sector"><span><i style="background:${colorSector(k)}"></i>${nombre(k).replace(/[<>&]/g, '')}${tiene ? `: ${fmt1(O().largoRamal(s))} m de caño, ${O().codosRamal(s)} ${O().codosRamal(s) === 1 ? 'codo' : 'codos'}` : ': caño sin dibujar'}</span>
          <span><button type="button" class="chico" data-ramal="dibujar" data-s="${k}">${tiene ? 'Dibujar de nuevo' : 'Dibujar caño'}</button>${tiene ? `<button type="button" class="chico peligro" data-ramal="borrar" data-s="${k}">Borrar</button>` : ''}</span></div>`;
      }).join('');
      giro = `<p class="ayuda">Las válvulas van juntas a la salida de la bomba; de cada una sale el caño de su sector. Arrastrá la bomba para ubicarla.</p>${filas}`;
    }
    if (seleccion.tipo === 'valvula') {
      const s = ctx.obra.sectores[seleccion.s];
      titulo = `Válvula de ${nombre(seleccion.s)} (a la salida de la bomba)`;
      giro = O().tieneRamal(s)
        ? `<p class="ayuda">Caño principal: <b>${fmt1(O().largoRamal(s))} m</b>, ${O().codosRamal(s)} ${O().codosRamal(s) === 1 ? 'codo' : 'codos'}. Cada aspersor va con su manguera hasta el caño. Para acomodarlo, arrastrá los cuadraditos.</p>
          <div class="giros"><button type="button" class="chico" data-ramal="dibujar">Dibujar de nuevo</button><button type="button" class="chico peligro" data-ramal="borrar">Borrar caño</button></div>`
        : `<p class="ayuda">Dibujá el caño principal del sector y la app tira la manguera de cada aspersor hasta el caño y calcula los metros solos.</p>
          <button type="button" class="chico" data-ramal="dibujar">Dibujar el caño principal</button>`;
    }
    if (seleccion.tipo === 'codo') {
      const s = ctx.obra.sectores[seleccion.s], ultimo = seleccion.i === s.ramal.length - 1;
      titulo = `${ultimo ? 'Final del caño (tapón)' : `Codo ${seleccion.i + 1}`} · ${nombre(seleccion.s)}`;
      giro = '<button type="button" class="chico peligro" data-ramal="quitar-punto">Quitar este punto</button>';
    }
    if (seleccion.tipo === 'asp') {
      const a = ctx.aspersores().find(x => x.s === seleccion.s && x.i === seleccion.i);
      const nombreSector = nombre(seleccion.s);
      titulo = a ? `${nombreSector} · aspersor ${a.num ?? a.i + 1}: ${a.nombre} · alcance ${a.radio.toFixed(1).replace('.', ',')} m`
        : `${nombreSector} · aspersor ${O().numero(ctx.obra.sectores[seleccion.s], seleccion.i)}: arco de ${obj.arco}° no válido para esta boquilla (elegí otro)`;
      const manguera = O().tieneRamal(ctx.obra.sectores[seleccion.s])
        ? `<p class="ayuda ${obj.manguera > 6 ? 'aviso-arco' : ''}">Manguera hasta el caño: <b>${fmt1(obj.manguera)} m</b>${obj.manguera > 6 ? ' (más de 6 m: acercalo al caño o llevá el caño más cerca)' : ''}.</p>` : '';
      const tb = ctx.tobera, n = tb ? tb.normalizar(obj) : null;
      const sel = (campo, lista, valor) => `<select data-asp="${campo}">${lista.map(([v, t]) => `<option value="${String(v).replace(/"/g, '&quot;')}" ${String(v) === String(valor ?? '') ? 'selected' : ''}>${String(t).replace(/[<>&]/g, '')}</option>`).join('')}</select>`;
      const toberas = tb ? `<div class="campos dos">
          <label>Aspersor ${sel('tipo', tb.tipos.map(t => [t, t]), obj.tipo)}</label>
          <label>Boquilla ${sel('boquilla', tb.boquillas(obj.tipo), obj.boquilla)}</label>
          ${n.conCuerpo ? `<label>Cuerpo Pro-Spray ${sel('regulador', [['', 'Sin regulador'], ['PRS30', 'PRS30 · 2,1 bar'], ['PRS40', 'PRS40 · 2,8 bar']], obj.regulador || '')}</label>` : ''}
          ${ctx.obra.sectores.length > 1 ? `<label>Sector ${sel('sector', ctx.obra.sectores.map((s, k) => [k, nombre(k)]), seleccion.s)}</label>` : ''}
        </div>` : '';
      const sinCano = !O().tieneRamal(ctx.obra.sectores[seleccion.s]) && plano().bombaUbicada
        ? `<p class="ayuda aviso-arco">${nombre(seleccion.s).replace(/[<>&]/g, '')}: falta dibujar el caño. La manguera de cada aspersor va al punto más cercano del caño.</p>` : '';
      arriba = toberas + sinCano;
      giro = manguera + controlArco(obj, a) + (a && a.arco >= 360 && !a.franja ? '<p class="ayuda">Círculo completo: no hace falta girarlo.</p>' : `
        <label>Hacia dónde apunta <span class="unidad">° (0 = arriba, 90 = derecha, 180 = abajo, 270 = izquierda)</span><input type="number" inputmode="numeric" step="5" data-sel="giro" value="${Math.round(obj.giro || 0)}"></label>
        <div class="giros"><button type="button" class="chico" data-girar="-45">⟲ 45°</button><button type="button" class="chico" data-girar="-15">⟲ 15°</button>
        <button type="button" class="chico" data-girar="15">15° ⟳</button><button type="button" class="chico" data-girar="45">45° ⟳</button></div>`)
        + botones([['alinear-asp', 'Alinear con el borde'], ['duplicar-asp', 'Duplicar', 'activo'], ['quitar-asp', 'Quitar aspersor', 'peligro']]);
    }
    // La válvula no se ubica a mano: va a la salida de la bomba
    caja.innerHTML = `<p class="sel-titulo">${titulo.replace(/[<>&]/g, '')}</p>${arriba}
      <div class="campos dos" ${seleccion.tipo === 'valvula' ? 'hidden' : ''}>
        <label>X <span class="unidad">m desde la izquierda</span><input type="text" inputmode="decimal" autocomplete="off" step="0.1" data-sel="x" value="${obj.x}"></label>
        <label>Y <span class="unidad">m desde abajo</span><input type="text" inputmode="decimal" autocomplete="off" step="0.1" data-sel="y" value="${obj.y}"></label>
      </div>${giro}`;
  }

  // Arco del abanico (cuánto abre): se escribe cualquiera de 1° a 360° (Darío). Si una boquilla fija no viene
  // en ese arco, OBRA.ponerArco la cambia por la ajustable del mismo tamaño y avisa. Es el mismo arco de la pestaña Diseño.
  let avisoArco = '';
  function controlArco(obj, a) {
    if (a?.franja || obj.tipo === 'MP Rotator de franja') return '';
    const mp = O().esMP(obj), mp3500 = mp && obj.boquilla === 'MP3500';
    const rapidos = mp3500 ? [90, 180, 210] : mp ? [90, 180, 270, 360] : [45, 90, 180, 270, 360];
    const ayuda = mp ? (mp3500 ? 'la MP3500 va de 90° a 210°' : 'las MP van de 90° a 270°, o 360°') : 'cualquiera de 1° a 360°';
    return `<label>Arco: cuánto abre <span class="unidad">° (${ayuda})</span><input type="number" inputmode="numeric" step="1" min="1" max="360" data-arco-libre value="${obj.arco ?? ''}"></label>
      <div class="giros">${rapidos.map(x => `<button type="button" class="chico ${Number(obj.arco) === x ? 'activo' : ''}" data-arco="${x}">${x}°</button>`).join('')}</div>
      ${avisoArco ? `<p class="ayuda aviso-arco">${avisoArco.replace(/[<>&]/g, '')}</p>` : ''}`;
  }
  function elegirArco(valor) {
    try { avisoArco = O().ponerArco(objeto(seleccion), valor) || ''; } catch (err) { avisoArco = err.message; }
    avisarCambio(false);
    pintar();
  }

  const nombre = k => ctx.obra.sectores[k].nombre || `Sector ${k + 1}`;
  const fmt1 = v => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');

  function objeto(sel) {
    if (sel.tipo === 'fuente') return plano().fuente;
    if (sel.tipo === 'valvula') return ctx.obra.sectores[sel.s].valvulaPos;
    if (sel.tipo === 'codo') return ctx.obra.sectores[sel.s].ramal[sel.i];
    if (sel.tipo === 'vertice') return plano().zonas[sel.s][sel.i];
    return ctx.obra.sectores[sel.s].aspersores[sel.i];
  }

  const trabado = () => !!plano().trabado;
  // Qué tramo del caño (0 = de la válvula al primer punto) queda más cerca del toque
  function tramoTocado(k, p) {
    const s = ctx.obra.sectores[k], linea = [s.valvulaPos, ...(s.ramal || [])];
    let mejor = 0, dist = Infinity;
    for (let i = 0; i < linea.length - 1; i++) { const d = G.puntoMasCercano([linea[i], linea[i + 1]], p).distancia; if (d < dist) { dist = d; mejor = i; } }
    return mejor;
  }
  const mismaPieza = (a, b) => !!a && !!b && a.tipo === b.tipo && a.s === b.s && a.i === b.i;

  // ---------- Sugerir mejoras de cobertura: una consulta (botón), no un aviso ----------
  // Cada idea trae "Ver" (lleva al plano y pinta la parte que mejora) y "Aplicar"; arriba, "Aplicar todas".
  // Después de aplicar queda "Deshacer" (vuelve los aspersores tocados a como estaban).
  let consulta = null, consultaAplicada = false;
  const DIRECCIONES = ['arriba', 'arriba a la derecha', 'a la derecha', 'abajo a la derecha', 'abajo', 'abajo a la izquierda', 'a la izquierda', 'arriba a la izquierda'];
  const direccion = r => DIRECCIONES[Math.round((((r % 360) + 360) % 360) / 45) % 8];
  const limpio = t => String(t).replace(/[<>&]/g, '');
  const m1 = v => String(v).replace('.', ',');
  // Qué se le puede cambiar a cada aspersor: el arco (si es libre) y la boquilla (otras del mismo tipo que sirven con su arco)
  function opcionesDe(p) {
    const a = ctx.obra.sectores[p.s].aspersores[p.i], R = global.RIEGO;
    const arco = p.franja || !O().arcoLibre(a) ? null : O().esMP(a) ? (a.boquilla === 'MP3500' ? [90, 210] : [90, 270]) : [25, 360];
    const boquillas = [];
    if (!p.franja && ctx.tobera) {
      let medio = null;
      try { const e = R.emisor(O().idEmisor(a)); medio = e.radios[Math.floor(e.radios.length / 2)]; } catch { /* sin datos: no se prueban boquillas */ }
      if (medio) for (const [b] of ctx.tobera.boquillas(a.tipo)) {
        if (b === a.boquilla) continue;
        const copia = { ...a, boquilla: b };
        ctx.tobera.normalizar(copia);
        if (copia.arco !== a.arco || copia.boquilla !== b) continue;   // con otro arco no es el mismo aspersor
        try { const e = R.emisor(O().idEmisor(copia)); boquillas.push({ boquilla: b, radio: p.radio * e.radios[Math.floor(e.radios.length / 2)] / medio }); } catch { /* esa combinación no existe */ }
      }
    }
    return { arco, boquillas };
  }
  function armarConsulta() {
    const lista = ctx.aspersores();
    const r = G.sugerirCobertura(plano(), lista.map(p => ({ ...p, boquilla: ctx.obra.sectores[p.s].aspersores[p.i].boquilla })), plano().zonas, lista.map(opcionesDe));
    const quien = k => `el aspersor ${lista[k].num ?? lista[k].i + 1} de ${limpio(nombre(lista[k].s))}`;
    const items = r.pasos.map(s => {
      const p = lista[s.k], vec = s.vecino != null ? ` entre él y ${quien(s.vecino)}` : '';
      const mejora = s.bien >= 0.1 ? `Bien cubierto: +${s.bien.toFixed(1).replace('.', ',')} %.` : 'Queda menos parte seca.';
      let texto;
      if (s.tipo === 'girar') texto = `Girá ${quien(s.k)} ${Math.abs(s.valor)}° ${s.valor > 0 ? 'a la derecha (como el reloj)' : 'a la izquierda'}: cubre mejor la parte${vec}.`;
      else if (s.tipo === 'arco') texto = `${s.valor > p.arco ? 'Abrí' : 'Cerrá'} el arco de ${quien(s.k)} de ${Math.round(p.arco)}° a ${s.valor}°: mejora la parte${vec}, sin mojar afuera.`;
      else if (s.tipo === 'boquilla') texto = `Cambiá la boquilla ${quien(s.k).replace(/^el/, 'del')}: de la ${limpio(s.de)} a la ${limpio(s.valor)}. Llega mejor a la parte${vec} sin pasarse del borde.`;
      else if (s.lados && s.lados.contrario > s.lados.haciaDonde)
        texto = `${quien(s.k).replace(/^el/, 'El')} (círculo completo) superpone mucho ${direccion(s.valor.rumbo + 180)} y poco ${direccion(s.valor.rumbo)}: corrélo ${m1(s.valor.metros)} m ${direccion(s.valor.rumbo)}.`;
      else texto = `Corré ${quien(s.k)} ${m1(s.valor.metros)} m ${direccion(s.valor.rumbo)}: cubre mejor la parte${vec}.`;
      return { texto, mejora, s: p.s, i: p.i, tipo: s.tipo, valor: s.valor, punto: s.punto, celdas: s.celdas };
    });
    const faltan = r.faltan.map(f => ({ ...f, texto: f.m2 > 25 ? `Queda una parte grande (${m1(f.m2)} m²) ${f.seca ? 'seca' : 'regada por un solo aspersor'}: faltan aspersores ahí.`
      : `Queda una parte de ${m1(f.m2)} m² ${f.seca ? 'seca' : 'regada por un solo aspersor'}${items.length ? ', aun con los cambios de arriba' : ''}: con otro aspersor ahí se lograría superposición.` }));
    return { antes: r.antes, despues: r.despues, items, faltan, paso: r.paso, marca: null };
  }
  function pintarConsulta() {
    if (!consulta) return `<div class="consulta"><button type="button" class="chico" data-sugerir="calcular">Sugerir mejoras de cobertura</button></div>`;
    if (consulta.hecho) return `<div class="consulta"><p class="sel-titulo">Aplicado</p><ul class="sugerencias">${consulta.hecho.map(t => `<li><span>${t}</span></li>`).join('')}</ul>
      <div class="acciones-sug"><button type="button" class="chico peligro" data-sugerir="deshacer">Deshacer</button><button type="button" class="chico" data-sugerir="calcular">Sugerir de nuevo</button></div></div>`;
    const ver = (tipo, n) => `<button type="button" class="chico" data-sugerir="${tipo}" data-n="${n}">Ver</button>`;
    const filas = [
      ...consulta.items.map((x, n) => `<li class="${consulta.viendo === 'i' + n ? 'viendo' : ''}"><span>${x.texto} <b>${x.mejora}</b></span><span class="acciones-sug">${ver('ver', n)}<button type="button" class="chico activo" data-sugerir="aplicar" data-n="${n}">Aplicar</button></span></li>`),
      ...consulta.faltan.map((f, n) => `<li class="${consulta.viendo === 'f' + n ? 'viendo' : ''}"><span>${f.texto}</span><span class="acciones-sug">${ver('ver-falta', n)}</span></li>`),
    ];
    const a = consulta.antes, d = consulta.despues;
    return `<div class="consulta"><p class="sel-titulo">Sugerencias para mejorar la cobertura</p>
      ${a ? `<p class="ayuda">Hoy: ${a.bien.toFixed(0)} % bien cubierto, ${a.uno.toFixed(0)} % con un solo aspersor, ${a.seco.toFixed(0)} % seco (dentro de la zona). Ninguna idea moja afuera de la zona. Van en orden: cada una cuenta con las de arriba hechas.</p>` : ''}
      ${consulta.items.length > 1 ? `<button type="button" class="chico activo" data-sugerir="aplicar-todas">Aplicar todas (bien cubierto: ${a.bien.toFixed(1).replace('.', ',')} % → ${d.bien.toFixed(1).replace('.', ',')} %)</button>` : ''}
      ${filas.length ? `<ul class="sugerencias">${filas.join('')}</ul>` : '<p class="ayuda">No encontré cambios chicos que mejoren la cobertura sin mojar afuera: así como está, está bien.</p>'}
      <button type="button" class="chico" data-sugerir="cerrar">Cerrar</button></div>`;
  }
  // Lleva la vista al plano, centrada en la parte de la que habla la idea
  function mirarA(p) {
    if (p) vista = { ...vista, x: p.x - vista.w / 2, y: Y(p.y) - vista.h / 2 };
    pintar();
    // Sube hasta el plano (debajo de las pestañas de la obra, que quedan fijas arriba)
    setTimeout(() => window.scrollBy({ top: ctx.svg.getBoundingClientRect().top - 80 }), 0);
  }
  function aplicarIdea(x) {
    const obj = ctx.obra.sectores[x.s].aspersores[x.i];
    const antes = { obj, datos: { giro: obj.giro, arco: obj.arco, x: obj.x, y: obj.y, tipo: obj.tipo, boquilla: obj.boquilla } };
    if (x.tipo === 'girar') obj.giro = (((obj.giro || 0) + x.valor) % 360 + 360) % 360;
    if (x.tipo === 'arco') { try { avisoArco = O().ponerArco(obj, x.valor) || ''; } catch (err) { avisoArco = err.message; } }
    if (x.tipo === 'mover') { obj.x = x.valor.x; obj.y = x.valor.y; }
    if (x.tipo === 'boquilla') { obj.boquilla = x.valor; ctx.tobera?.normalizar(obj); }
    return antes;
  }
  function accionConsulta(b) {
    const accion = b.dataset.sugerir, n = Number(b.dataset.n);
    if (accion === 'calcular') { b.textContent = 'Pensando…'; b.disabled = true; setTimeout(() => { consulta = armarConsulta(); pintar(); }, 30); return; }
    if (accion === 'cerrar') { consulta = null; return pintar(); }
    if (accion === 'ver-falta') { const f = consulta.faltan[n]; consulta.marca = { celdas: f.celdas, punto: f }; consulta.viendo = 'f' + n; seleccion = null; return mirarA(f); }
    if (accion === 'deshacer') {
      for (const c of (consulta.deshacer || []).reverse()) Object.assign(c.obj, c.datos);
      avisoArco = '';
      consulta = null;
      avisarCambio(true);
      return pintar();
    }
    const elegidas = accion === 'aplicar-todas' ? consulta.items : [consulta.items[n]];
    const x = elegidas[0];
    if (accion === 'ver') { consulta.marca = { celdas: x.celdas, punto: x.punto }; consulta.viendo = 'i' + n; seleccion = { tipo: 'asp', s: x.s, i: x.i }; return mirarA(x.punto); }
    if (accion === 'aplicar' || accion === 'aplicar-todas') {
      avisoArco = '';
      const deshacer = elegidas.map(aplicarIdea);
      const hecho = elegidas.map(e => e.texto);
      seleccion = elegidas.length === 1 ? { tipo: 'asp', s: x.s, i: x.i } : null;
      consultaAplicada = true;
      consulta = { hecho, deshacer };
      avisarCambio(true);
      consultaAplicada = false;
      return pintar();
    }
  }

  // Avisa a la pantalla que algo cambió (recalcula y guarda). Con ramal, los aspersores se reordenan según el caño:
  // la selección sigue al mismo aspersor aunque cambie su número.
  function avisarCambio(distancias) {
    if (!consultaAplicada) consulta = null;
    const obj = seleccion?.tipo === 'asp' ? objeto(seleccion) : null;
    ctx.alCambiar(distancias);
    if (obj) {
      const i = ctx.obra.sectores[seleccion.s].aspersores.indexOf(obj);
      if (i >= 0) seleccion = { ...seleccion, i };
    }
  }

  // Dibujar el caño principal de un sector: cada toque en el plano agrega un codo; "Listo" lo guarda.
  function dibujarRamal(k) {
    seleccion = null;
    marcando = { tipo: 'ramal', s: k, n: Infinity, etiquetas: null, puntos: [], desde: ctx.obra.sectores[k].valvulaPos,
      alMarcar: () => pintarSeleccion(), alTerminar: () => {} };
    pintar();
  }
  function accionRamal(accion, k) {
    const r2 = v => Math.round(v * 100) / 100;
    if (accion === 'dibujar') return dibujarRamal(k ?? seleccion.s);
    if (marcando?.tipo === 'ramal') {
      const k = marcando.s;
      if (accion === 'deshacer') { marcando.puntos.pop(); return pintar(); }
      if (accion === 'listo' && marcando.puntos.length) { ctx.obra.sectores[k].ramal = marcando.puntos.map(p => ({ x: r2(p.x), y: r2(p.y) })); delete ctx.obra.sectores[k].ramalDiametros; }
      marcando = null;
      seleccion = accion === 'listo' && O().tieneRamal(ctx.obra.sectores[k]) ? { tipo: 'cano', s: k } : { tipo: 'fuente' };
      ultimoSector = k;
      avisarCambio(true);
      return pintar();
    }
    if (accion === 'quitar-punto' && seleccion?.tipo === 'codo') {
      const s = ctx.obra.sectores[seleccion.s];
      s.ramal.splice(seleccion.i, 1);
      s.ramalDiametros?.splice(seleccion.i + 1, 1);
      if (!s.ramal.length) delete s.ramal;
      ultimoSector = seleccion.s;
      seleccion = { tipo: 'fuente' };
      avisarCambio(true);
      return pintar();
    }
  }

  // ---------- Zonas a regar, agregar y ubicar aspersores ----------
  const r2 = v => Math.round(v * 100) / 100;
  function dibujarZona() {
    seleccion = null; midiendo = null;
    marcando = { tipo: 'zona', n: Infinity, etiquetas: null, puntos: [], alMarcar: () => pintarSeleccion(), alTerminar: () => {} };
    pintar();
  }
  // "+ Aspersor": un toque pone UN aspersor en el sector elegido (con la misma tobera que el último) y lo deja elegido,
  // para acomodarlo, girarlo y abrirle el arco enseguida. Para el siguiente, otra vez "+ Aspersor".
  function agregarAspersores(k, copia) {
    seleccion = null;
    if (k == null) { marcando = { tipo: 'elegir-sector', n: 0, puntos: [] }; return pintar(); }
    ultimoSector = k;
    marcando = { tipo: 'aspersores', s: k, n: Infinity, etiquetas: [], puntos: [], puestos: 0, copia,
      alMarcar: () => {
        const s = ctx.obra.sectores[k], p = marcando.puntos.pop();
        const ubicados = s.aspersores.filter(a => a.x != null);
        const base = copia || ubicados.at(-1) || s.aspersores.at(-1) || global.ALMACEN.aspersorInicial(0);
        const anterior = ubicados.at(-1) || s.valvulaPos;
        const { x, y, ...tobera } = base;
        // Apunta hacia el centro de la zona más cercana (en el borde, así riega hacia adentro y no a la vereda)
        const zonas = plano().zonas || [];
        const zona = zonas.find(z => G.dentroDePoligono(z, p.x, p.y)) || (zonas.length ? zonas[G.ladoMasCercano(zonas, p).zona] : null);
        const centro = zona && { x: zona.reduce((t, q) => t + q.x, 0) / zona.length, y: zona.reduce((t, q) => t + q.y, 0) / zona.length };
        const giro = copia ? (copia.giro ?? 0) : centro ? Math.round(G.rumbo(centro.x - p.x, centro.y - p.y) / 5) * 5 % 360 : (base.giro ?? 0);
        s.aspersores.push({ ...tobera, x: r1(p.x), y: r1(p.y), giro,
          distancia: r1(Math.hypot(p.x - anterior.x, p.y - anterior.y)) || 1, manguera: base.manguera ?? 1 });
        avisoArco = '';
        if (copia) {   // Duplicar: queda listo para la próxima copia
          marcando.puestos++;
          avisarCambio(true);
          return pintar();
        }
        marcando = null;
        seleccion = { tipo: 'asp', s: k, i: s.aspersores.length - 1 };
        avisarCambio(true);   // con caño dibujado se reordena: la selección sigue al mismo aspersor
        pintar();
      } };
    pintar();
  }
  // Después de definir el plano, lo primero es la bomba: de ahí salen los caños de los sectores.
  const nombreFuente = () => ctx.obra.fuente.tipo === 'bomba' ? 'la bomba' : 'la canilla';
  function ubicarBomba() {
    seleccion = null;
    marcando = { tipo: 'bomba', n: 1, etiquetas: [''], puntos: [], alTerminar: p => {
      const t = plano();
      t.fuente = { x: r1(Math.min(t.ancho, Math.max(0, p.x))), y: r1(Math.min(t.largo, Math.max(0, p.y))) };
      t.bombaUbicada = true;
      marcando = null;
      seleccion = { tipo: 'fuente' };   // se abre el panel con "Dibujar caño" de cada sector
      avisarCambio(true);
      pintar();
    } };
    pintar();
  }
  // Al terminar la escala de la zona: si la bomba todavía no está, se pide enseguida
  const seguirConBomba = () => { if (!plano().bombaUbicada) ubicarBomba(); };

  function ubicar(k, i) {
    seleccion = null;
    marcando = { tipo: 'ubicar', s: k, i, n: 1, etiquetas: [''], puntos: [], alTerminar: p => {
      const a = ctx.obra.sectores[k].aspersores[i];
      a.x = r1(p.x); a.y = r1(p.y); a.giro ??= 0;
      marcando = null;
      seleccion = { tipo: 'asp', s: k, i };
      avisarCambio(true);
      pintar();
    } };
    pintar();
  }
  // Escalar con la medida real de un lado de la zona: todo el plano (foto, zonas, aspersores) se multiplica.
  function aplicarMedida(valor) {
    const z = plano().zonas[midiendo.zona], a = z[midiendo.lado], b = z[(midiendo.lado + 1) % z.length];
    let k;
    try { k = G.factorDeEscala(a, b, valor); } catch { midiendo.error = 'Escribí cuántos metros mide ese lado.'; return pintar(); }
    G.escalarPlano(plano(), ctx.obra.sectores, k);
    if (plano().fondo) plano().fondo.escala = { metros: valor };
    midiendo = null;
    editandoZona = null;
    avisarCambio(true);
    ctx.alEscalar?.();
    ajustar(); pintar();
    seguirConBomba();
  }
  function accionModo(accion) {
    const quitar = (boton, hacer) => {
      if (!boton.dataset.confirmar) { boton.dataset.confirmar = '1'; boton.textContent = 'Tocá de nuevo para confirmar'; return; }
      hacer();
    };
    return {
      'deshacer': () => { marcando.puntos.pop(); pintar(); },
      'cancelar': () => { marcando = null; pintar(); },
      'zona-listo': () => {
        const z = marcando.puntos.map(p => ({ x: r2(p.x), y: r2(p.y) }));
        (plano().zonas ||= []).push(z);
        marcando = null;
        seleccion = { tipo: 'zona', s: plano().zonas.length - 1 };
        editandoZona = seleccion.s;
        midiendo = { esperando: true };   // enseguida: ¿qué lado conocés?
        avisarCambio(false);
        pintar();
      },
      'medir': () => { midiendo = { esperando: true }; pintar(); },
      'medir-otro': () => { midiendo = { esperando: true }; pintar(); },
      'medir-cancelar': () => { midiendo = null; editandoZona = null; pintar(); seguirConBomba(); },
      'editar-zona': () => { editandoZona = seleccion.s; pintar(); },
      'zona-terminar': () => { editandoZona = null; midiendo = null; seleccion = null; pintar(); },
      'medir-aplicar': () => aplicarMedida(global.RIEGO.leerNumero([ctx.flotante, ctx.seleccion].map(c => c?.querySelector('[data-medida-real]')?.value).find(v => v))),
      'quitar-esquina': () => {
        plano().zonas[seleccion.s].splice(seleccion.i, 1);
        seleccion = { tipo: 'zona', s: seleccion.s };
        avisarCambio(false); pintar();
      },
    }[accion];
  }

  // Vista que muestra todo el terreno con un margen.
  function ajustar() {
    const t = plano(), m = Math.max(0.5, Math.max(t.ancho, t.largo) * 0.03);
    const svg = ctx.svg;
    // A la derecha van los botones de zoom: el terreno se acomoda a su izquierda, para que ninguna esquina
    // de la foto quede debajo de un botón.
    const BOTONES = 0;   // los botones de zoom van en una fila arriba del plano: la foto usa todo el ancho
    const libre = Math.max(100, (svg.clientWidth || 300) - BOTONES);
    // El cuadro del plano toma la forma del terreno (una captura parada ocupa casi toda la pantalla del teléfono)
    if (svg.clientWidth) {
      const alto = Math.round(Math.min(window.innerHeight * 0.75, Math.max(260, libre * (t.largo + 2 * m) / (t.ancho + 2 * m))));
      if (Math.abs(svg.clientHeight - alto) > 2) svg.style.height = `${alto}px`;
    }
    const ancho = svg.clientWidth || 300, alto = svg.clientHeight || 300;
    const k = Math.max((t.ancho + 2 * m) / libre, (t.largo + 2 * m) / alto);   // metros por pixel
    const w = ancho * k, h = alto * k;
    vista = { x: t.ancho / 2 - libre * k / 2, y: t.largo / 2 - h / 2, w, h };
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
      // Pellizco: agranda o achica alrededor de los dedos (no del centro) y, con los dos dedos apoyados, también corre el plano
      const r = ctx.svg.getBoundingClientRect();
      const medio = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
      gesto = { tipo: 'pellizco', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, vista: { ...vista },
        ancla: { x: vista.x + medio.x * vista.w / r.width, y: vista.y + medio.y * vista.h / r.height } };
      return;
    }
    // Agarraderas del abanico del aspersor elegido: girar o abrir/cerrar el arco (no con el plano trabado)
    const asa = !marcando && !trabado() ? ev.target.closest('[data-asa]') : null;
    if (asa) {
      const a = ctx.aspersores().find(x => x.s === seleccion.s && x.i === seleccion.i);
      const arco = a?.arco ?? 180, giro = a?.giro ?? 0;
      // La punta que no se agarra queda fija (Darío: que no se muevan las dos juntas)
      const fija = asa.dataset.asa === 'arco-izq' ? giro + arco / 2 : giro - arco / 2;
      gesto = { tipo: 'asa', asa: asa.dataset.asa, arco, giro, fija, x0: ev.clientX, y0: ev.clientY, movio: false };
      return;
    }
    // Mientras se marcan puntos, agarrar uno ya marcado lo corrige (no mueve el mapa)
    const marca = marcando ? ev.target.closest('[data-marca]') : null;
    if (marca) { gesto = { tipo: 'moverMarca', k: Number(marca.dataset.marca), x0: ev.clientX, y0: ev.clientY, movio: false }; return; }
    // Al marcar, un toque marca y no agarra piezas; al elegir el lado que se conoce, las esquinas se siguen pudiendo arrastrar
    // Con "+ Aspersor" activo, tocar un aspersor que ya está lo elige (no pone otro encima)
    const agregando = marcando?.tipo === 'aspersores' ? ev.target.closest('[data-mover="asp"]') : null;
    if (agregando) marcando = null;
    const pieza = agregando || (marcando ? null : ev.target.closest(midiendo ? '[data-mover="vertice"]' : '[data-mover]'));
    const zona = !marcando && !midiendo && !pieza ? ev.target.closest('[data-zona]') : null;
    const cano = !marcando && !midiendo && !pieza ? ev.target.closest('[data-cano]') : null;
    const p = aSVG(ev);
    if (pieza && trabado() && !agregando) {
      // Trabado: tocar una pieza la elige (para ver sus datos) y arrastrar mueve la vista, no la pieza
      gesto = { tipo: 'mirar', x0: ev.clientX, y0: ev.clientY, vista: { ...vista }, movio: false, zona: null, cano: null,
        tocada: { tipo: pieza.dataset.mover, s: Number(pieza.dataset.s), i: Number(pieza.dataset.i) } };
    } else if (pieza) {
      const sel = { tipo: pieza.dataset.mover, s: Number(pieza.dataset.s), i: Number(pieza.dataset.i) };
      const obj = objeto(sel);
      gesto = { tipo: 'mover', sel, dx: obj.x - p.x, dy: obj.y - (plano().largo - p.y), x0: ev.clientX, y0: ev.clientY, movio: false };
    } else gesto = { tipo: 'mirar', x0: ev.clientX, y0: ev.clientY, vista: { ...vista }, movio: false, zona: zona ? Number(zona.dataset.zona) : null, cano: cano ? Number(cano.dataset.cano) : null,
      tramo: cano ? tramoTocado(Number(cano.dataset.cano), { x: p.x, y: plano().largo - p.y }) : null };
  }
  function alMover(ev) {
    if (!punteros.has(ev.pointerId) || !gesto) return;
    punteros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const porPixel = vista.w / ctx.svg.clientWidth;
    if (gesto.tipo === 'pellizco' && punteros.size === 2) {
      const [a, b] = [...punteros.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const k = gesto.dist / (d || 1), v = gesto.vista, r = ctx.svg.getBoundingClientRect();
      const w = Math.min(500, Math.max(2, v.w * k)), h = v.h * w / v.w;
      // El punto del plano que estaba entre los dedos sigue entre los dedos
      const medio = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
      vista = { x: gesto.ancla.x - medio.x * w / r.width, y: gesto.ancla.y - medio.y * h / r.height, w, h };
      return repintar();
    }
    const mx = ev.clientX - gesto.x0, my = ev.clientY - gesto.y0;
    if (Math.hypot(mx, my) > 4) gesto.movio = true;
    if (!gesto.movio) return;
    if (gesto.tipo === 'mirar') {
      vista = { ...gesto.vista, x: gesto.vista.x - mx * porPixel, y: gesto.vista.y - my * porPixel };
      return repintar();
    }
    if (gesto.tipo === 'asa') {
      const p = aSVG(ev), obj = objeto(seleccion);
      const rumbo = G.rumbo(p.x - obj.x, (plano().largo - p.y) - obj.y);
      if (gesto.asa === 'girar') obj.giro = Math.round(rumbo) % 360;
      else {
        const vuelta = v => ((v % 360) + 360) % 360;
        let arco = Math.round(vuelta(gesto.asa === 'arco-der' ? rumbo - gesto.fija : gesto.fija - rumbo));
        if (arco < 1 || arco >= 358) arco = arco < 1 && gesto.arco < 180 ? 1 : 360;
        gesto.arco = arco;
        gesto.giro = vuelta(gesto.asa === 'arco-der' ? gesto.fija + arco / 2 : gesto.fija - arco / 2);
      }
      return repintar();
    }
    if (gesto.tipo === 'moverMarca' && marcando?.puntos[gesto.k]) {
      const p = aSVG(ev);
      marcando.puntos[gesto.k] = { x: p.x, y: plano().largo - p.y };
      return repintar();
    }
    if (gesto.tipo === 'mover') {
      if (gesto.sel.tipo === 'valvula') return;   // las válvulas van a la salida de la bomba: se mueve la bomba
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
    if (gesto.tipo === 'asa') {
      if (gesto.movio && gesto.asa !== 'girar') { objeto(seleccion).giro = Math.round(gesto.giro) % 360; elegirArco(gesto.arco); }   // aplica las reglas de Hunter (fija → ajustable, MP 90-270°)
      else { if (gesto.movio) avisarCambio(false); pintar(); }
    } else if (gesto.tipo === 'moverMarca') {
      // Tocar (sin arrastrar) la primera esquina cierra la zona
      if (!gesto.movio && gesto.k === 0 && marcando?.tipo === 'zona' && marcando.puntos.length > 2) accionModo('zona-listo')();
      else pintar();
    } else if (gesto.tipo === 'mover') {
      if (!gesto.movio) { if (!mismaPieza(seleccion, gesto.sel)) avisoArco = ''; seleccion = gesto.sel; }
      if (gesto.sel.tipo === 'asp' || gesto.sel.tipo === 'codo') ultimoSector = gesto.sel.s;
      if (gesto.sel.tipo === 'fuente' && gesto.movio) plano().bombaUbicada = true;
      avisarCambio(gesto.movio);
      pintar();
    } else if (gesto.tipo === 'mirar' && !gesto.movio && midiendo?.esperando) {
      // Elegir el lado de la zona que se conoce: el más cercano al toque
      const p = aSVG(ev), lado = G.ladoMasCercano(plano().zonas || [], { x: p.x, y: plano().largo - p.y });
      if (lado) midiendo = { zona: lado.zona, lado: lado.lado };
      pintar();
      (ctx.flotante?.querySelector('[data-medida-real]') || ctx.seleccion.querySelector('[data-medida-real]'))?.focus();
    } else if (gesto.tipo === 'mirar' && !gesto.movio && marcando && marcando.tipo !== 'elegir-sector') {
      const p = aSVG(ev), m = marcando;
      if (m.puntos.length === m.n) m.puntos = [];
      m.puntos.push({ x: p.x, y: plano().largo - p.y });
      pintar();
      if (m.puntos.length === m.n) m.alTerminar(...m.puntos);
      else m.alMarcar?.(m.puntos.length);
    } else if (gesto.tipo === 'mirar' && !gesto.movio && !marcando) {
      seleccion = gesto.tocada || (gesto.cano != null ? { tipo: 'cano', s: gesto.cano, tramo: gesto.tramo } : gesto.zona != null ? { tipo: 'zona', s: gesto.zona } : null);
      if (gesto.cano != null) ultimoSector = gesto.cano;
      avisoArco = '';
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
    avisoArco = '';
    midiendo = null;
    editandoZona = null;
    ultimoSector = null;
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
        if (b.dataset.zoom === 'candado') { plano().trabado = !trabado(); ctx.alCambiar(false); return pintar(); }
        if (b.dataset.zoom === 'ajustar') { ajustar(); pintar(); } else zoom(b.dataset.zoom === 'mas' ? 1 / 1.4 : 1.4);
      });
      ctx.seleccion.addEventListener('input', ev => {
        const campo = ev.target.dataset.sel;
        if (!campo || !seleccion) return;
        const v = global.RIEGO.leerNumero(ev.target.value);
        if (!Number.isFinite(v)) return;
        const obj = objeto(seleccion), t = plano();
        if (campo === 'giro') obj.giro = ((v % 360) + 360) % 360;
        if (campo === 'x') obj.x = r1(Math.min(t.ancho, Math.max(0, v)));
        if (campo === 'y') obj.y = r1(Math.min(t.largo, Math.max(0, v)));
        avisarCambio(campo !== 'giro');
        const foco = campo; pintar();
        ctx.seleccion.querySelector(`[data-sel=${foco}]`)?.focus();
      });
      // El arco escrito se toma al terminar de escribirlo (si no, al escribir "45" pasaría por 4°).
      ctx.seleccion.addEventListener('change', ev => {
        if (ev.target.matches('[data-arco-libre]') && seleccion?.tipo === 'asp') elegirArco(global.RIEGO.leerNumero(ev.target.value));
        const campo = ev.target.dataset.asp;
        if (campo && seleccion?.tipo === 'asp') {
          const obj = objeto(seleccion);
          if (campo === 'sector') {
            // Pasa el aspersor a otro sector (su manguera va al caño de ese sector)
            const k = Number(ev.target.value), de = ctx.obra.sectores[seleccion.s].aspersores;
            de.splice(de.indexOf(obj), 1);
            ctx.obra.sectores[k].aspersores.push(obj);
            seleccion = { tipo: 'asp', s: k, i: ctx.obra.sectores[k].aspersores.length - 1 };
            ultimoSector = k;
          } else {
            obj[campo] = ev.target.value;
            ctx.tobera.normalizar(obj);
          }
          avisoArco = '';
          avisarCambio(true);
          pintar();
        }
      });
      const alTocarBoton = ev => {
        const arco = ev.target.closest('[data-arco]');
        if (arco && seleccion?.tipo === 'asp') return elegirArco(Number(arco.dataset.arco));
        const ramal = ev.target.closest('[data-ramal]');
        if (ramal) {
          // Borrar el caño entero pide un segundo toque
          if (ramal.dataset.ramal === 'borrar') {
            if (!ramal.dataset.confirmar) { ramal.dataset.confirmar = '1'; ramal.textContent = 'Tocá de nuevo para borrar'; return; }
            delete ctx.obra.sectores[ramal.dataset.s != null ? Number(ramal.dataset.s) : seleccion.s].ramal;
            avisarCambio(true);
            return pintar();
          }
          return accionRamal(ramal.dataset.ramal, ramal.dataset.s != null ? Number(ramal.dataset.s) : undefined);
        }
        const dt = ev.target.closest('[data-diametro-tramo]');
        if (dt && seleccion?.tipo === 'cano' && seleccion.tramo != null) {
          // Medida de un tramo: la primera vez, los demás tramos quedan con la medida que tenían en el plano
          const s = ctx.obra.sectores[seleccion.s];
          if (!O().tramosDelRamal(s)) {
            const asp = s.aspersores, diam = O().diametrosDelSector(ctx.obra, s), linea = [s.valvulaPos, ...s.ramal];
            let acum = 0;
            const tr = asp.map((a, i) => { acum += a.distancia || 0; return { hasta: acum, nominal: diam[i] }; });
            let desde = 0;
            s.ramalDiametros = linea.slice(1).map((p, i) => { const largo = Math.hypot(p.x - linea[i].x, p.y - linea[i].y); const medio = desde + largo / 2; desde += largo; return tr.length ? O().nominalEn(tr, medio) : s.lateral.nominal; });
          }
          s.ramalDiametros[seleccion.tramo] = Number(dt.dataset.diametroTramo);
          avisarCambio(true);
          return pintar();
        }
        const diam = ev.target.closest('[data-diametro]');
        if (diam && seleccion?.tipo === 'cano') {
          const l = ctx.obra.sectores[seleccion.s].lateral;
          delete ctx.obra.sectores[seleccion.s].ramalDiametros;
          l.escalonado = diam.dataset.diametro === 'auto';
          if (!l.escalonado) l.nominal = Number(diam.dataset.diametro);
          avisarCambio(true);
          return pintar();
        }
        const sectorNuevo = ev.target.closest('[data-sector-nuevo]');
        if (sectorNuevo) return agregarAspersores(Number(sectorNuevo.dataset.sectorNuevo));
        const modo = ev.target.closest('[data-modo-accion]');
        if (modo) {
          const accion = modo.dataset.modoAccion;
          // Quitar algo pide un segundo toque
          if (accion === 'cano-dibujar') return dibujarRamal(seleccion.s);
          if (accion === 'cano-borrar') {
            if (!modo.dataset.confirmar) { modo.dataset.confirmar = '1'; modo.textContent = 'Tocá de nuevo para borrar'; return; }
            delete ctx.obra.sectores[seleccion.s].ramal; seleccion = null; avisarCambio(true); return pintar();
          }
          if (accion === 'alinear-asp') {
            // Gira y abre el abanico para que calce con el borde de la zona (o con la esquina)
            const obj = objeto(seleccion), t = plano();
            const zonas = t.zonas?.length ? t.zonas : [[{ x: 0, y: 0 }, { x: t.ancho, y: 0 }, { x: t.ancho, y: t.largo }, { x: 0, y: t.largo }]];
            const r = G.alinearConBorde(zonas, obj);
            if (!r) return;
            obj.giro = r.giro;
            return elegirArco(r.arco);
          }
          if (accion === 'duplicar-asp') return agregarAspersores(seleccion.s, { ...objeto(seleccion) });
          if (accion === 'quitar-zona' || accion === 'quitar-asp') {
            if (!modo.dataset.confirmar) { modo.dataset.confirmar = '1'; modo.textContent = 'Tocá de nuevo para quitar'; return; }
            if (accion === 'quitar-zona') { plano().zonas.splice(seleccion.s, 1); avisarCambio(false); }
            else { ctx.obra.sectores[seleccion.s].aspersores.splice(seleccion.i, 1); avisarCambio(true); }
            seleccion = null;
            return pintar();
          }
          return accionModo(accion)?.();
        }
        const b = ev.target.closest('[data-girar]');
        if (!b || !seleccion) return;
        const obj = objeto(seleccion);
        obj.giro = (((obj.giro || 0) + Number(b.dataset.girar)) % 360 + 360) % 360;
        avisarCambio(false);
        pintar();
      };
      ctx.seleccion.addEventListener('click', alTocarBoton);
      ctx.estadisticas.addEventListener('click', ev => { const b = ev.target.closest('[data-sugerir]'); if (b) accionConsulta(b); });
      ctx.flotante?.addEventListener('click', alTocarBoton);
      // En la barra flotante, Enter en la medida aplica la escala
      ctx.flotante?.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.matches('[data-medida-real]')) accionModo('medir-aplicar')(); });
      // Botones de arriba del plano
      ctx.acciones?.addEventListener('click', ev => {
        const b = ev.target.closest('[data-plano], [data-ubicar]');
        if (!b) return;
        if (b.dataset.ubicar) { const [k, i] = b.dataset.ubicar.split(',').map(Number); ubicar(k, i); }
        else if (b.dataset.plano === 'zona') dibujarZona();
        else if (b.dataset.plano === 'bomba') ubicarBomba();
        else if (b.dataset.plano === 'sector') {
          // Sector nuevo desde el plano: queda elegido para seguir trabajando en él
          const sectores = ctx.obra.sectores;
          sectores.push(global.ALMACEN.sectorNuevo(sectores.length + 1));
          soloSector = ultimoSector = sectores.length - 1;
          avisarCambio(true); pintarFiltro(); pintar();
        }
        else if (b.dataset.plano === 'cano') {
          const k = soloSector ?? (ctx.obra.sectores.length === 1 ? 0 : ultimoSector);
          if (k == null) { seleccion = { tipo: 'fuente' }; pintar(); }   // elegir el sector en el panel de la bomba
          else dibujarRamal(k);
        }
        else {
          const sectores = ctx.obra.sectores;
          const delElegido = ['asp', 'codo'].includes(seleccion?.tipo) ? seleccion.s : ultimoSector;
          agregarAspersores(soloSector ?? (sectores.length === 1 ? 0 : delElegido));
        }
        ctx.svg.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    dibujarZona: () => ctx && dibujarZona(),
    reencuadrar: () => { if (ctx) { ajustar(); pintar(); } },
    coberturaActual: () => ctx ? G.cobertura(plano(), ctx.aspersores(), 0.25, plano().zonas) : null };
})(typeof window !== 'undefined' ? window : globalThis);
