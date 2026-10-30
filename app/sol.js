// Sol y sombra del terreno: por dónde pasa el sol y cuántas horas de sol directo recibe cada punto,
// según la latitud, la época del año, hacia dónde está el norte del plano y lo que hace sombra (casas, muros, árboles).
// Mismas coordenadas que GEOMETRIA: metros, x a la derecha, y hacia arriba; rumbos 0° arriba y en el sentido del reloj.
// Sin pantalla: lo usan el plano, la vista 3D y las pruebas.

(function (global) {
  const rad = g => g * Math.PI / 180, grados = r => r * 180 / Math.PI;

  // Alturas rápidas para marcar sin escribir (en metros). La primera es la que se pone al marcar.
  const TIPOS = {
    casa: { nombre: 'Casa o galpón', alturas: [[3, '1 piso'], [6, '2 pisos'], [9, '3 pisos']] },
    muro: { nombre: 'Muro o medianera', alturas: [[1.8, '1,8 m'], [2.5, '2,5 m'], [3, '3 m']] },
    arbol: { nombre: 'Árbol', alturas: [[6, 'Mediano'], [3, 'Chico'], [10, 'Grande']] },
  };
  const COPA = { 3: 1.5, 6: 3, 10: 5 };        // radio de copa (m) según el tamaño del árbol
  const ESPESOR_MURO = 0.25;

  // Día del año de cada época (hemisferio sur; en el norte se invierten verano e invierno).
  const EPOCAS = { verano: 'Verano', intermedia: 'Otoño y primavera', invierno: 'Invierno' };
  function diaDeEpoca(epoca, latitud) {
    if (epoca === 'intermedia') return 80;                       // 21 de marzo: igual que el 23 de septiembre
    const diciembre = 355, junio = 172;
    const sur = latitud < 0;
    return (epoca === 'verano') === sur ? diciembre : junio;
  }

  // Posición del sol en hora solar (12 = mediodía): altura sobre el horizonte y rumbo desde el norte (grados).
  function posicion(latitud, dia, hora) {
    const decl = rad(23.44) * Math.sin(rad(360 / 365 * (dia - 81)));
    const H = rad(15 * (hora - 12)), fi = rad(latitud);
    const este = -Math.cos(decl) * Math.sin(H);
    const norte = Math.sin(decl) * Math.cos(fi) - Math.cos(decl) * Math.sin(fi) * Math.cos(H);
    const arriba = Math.sin(decl) * Math.sin(fi) + Math.cos(decl) * Math.cos(fi) * Math.cos(H);
    return { altura: grados(Math.asin(Math.max(-1, Math.min(1, arriba)))), rumbo: (grados(Math.atan2(este, norte)) + 360) % 360 };
  }

  // Huella en el suelo de lo que hace sombra: polígono convexo (casa, muro) o círculo (árbol).
  function huella(o) {
    if (o.tipo === 'arbol') return { circulo: { x: o.x, y: o.y, r: o.radio } };
    if (o.tipo === 'muro') {
      const [a, b] = o.puntos, L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / L * ESPESOR_MURO / 2, ny = (b.x - a.x) / L * ESPESOR_MURO / 2;
      return { poligono: [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }] };
    }
    return { poligono: o.puntos };
  }

  // Casa a partir de tres toques: dos esquinas de un mismo lado y un punto del lado de enfrente → rectángulo (puede estar girado).
  function rectanguloDeTresPuntos(a, b, c) {
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(L > 0.2)) throw new Error('Las dos primeras esquinas tienen que estar separadas.');
    const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
    const fondo = (c.x - a.x) * nx + (c.y - a.y) * ny;
    if (!(Math.abs(fondo) > 0.2)) throw new Error('El tercer punto tiene que estar del otro lado de la casa.');
    const r2 = v => Math.round(v * 100) / 100;
    return [a, b, { x: b.x + nx * fondo, y: b.y + ny * fondo }, { x: a.x + nx * fondo, y: a.y + ny * fondo }].map(p => ({ x: r2(p.x), y: r2(p.y) }));
  }

  // Polígono en sentido contrario al reloj, para que las normales de los lados apunten hacia afuera.
  function antihorario(pol) {
    let area = 0;
    for (let i = 0; i < pol.length; i++) { const p = pol[i], q = pol[(i + 1) % pol.length]; area += p.x * q.y - q.x * p.y; }
    return area < 0 ? [...pol].reverse() : pol;
  }
  const dentro = (pol, x, y) => pol.every((p, i) => { const q = pol[(i + 1) % pol.length]; return (q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x) >= 0; });

  // Distancia horizontal desde (x, y), mirando hacia (dx, dy), hasta donde el rayo entra en la huella (0 si ya está adentro), o null.
  function entrada(h, x, y, dx, dy) {
    if (h.circulo) {
      const c = h.circulo, px = x - c.x, py = y - c.y;
      const b = px * dx + py * dy, cc = px * px + py * py - c.r * c.r, disc = b * b - cc;
      if (disc < 0) return null;
      const t2 = -b + Math.sqrt(disc);
      return t2 < 0 ? null : Math.max(0, -b - Math.sqrt(disc));
    }
    const pol = h.poligono;
    let tE = -Infinity, tS = Infinity;
    for (let i = 0; i < pol.length; i++) {
      const p = pol[i], q = pol[(i + 1) % pol.length];
      const nx = q.y - p.y, ny = -(q.x - p.x);                   // normal hacia afuera (polígono antihorario)
      const num = nx * (x - p.x) + ny * (y - p.y), den = nx * dx + ny * dy;
      if (Math.abs(den) < 1e-12) { if (num > 0) return null; continue; }
      const t = -num / den;
      if (den < 0) tE = Math.max(tE, t); else tS = Math.min(tS, t);
      if (tE > tS) return null;
    }
    return tS < 0 ? null : Math.max(0, tE);
  }

  // Horas de sol directo en cada punto del terreno (grilla de "paso" metros) para un día de la época elegida.
  // opciones: { latitud, norte (rumbo del norte en el plano, 0 = arriba), epoca }
  // Devuelve la grilla (horas; -1 = bajo techo) y los porcentajes de sol pleno (6 h o más), media sombra (3 a 6 h) y sombra (menos de 3 h).
  function mapa(terreno, obstaculos, opciones, paso) {
    paso ??= Math.max(0.25, Math.max(terreno.ancho, terreno.largo) / 160);
    const { latitud = -34.6, norte = 0, epoca = 'verano' } = opciones;
    const dia = diaDeEpoca(epoca, latitud);
    const nx = Math.max(1, Math.round(terreno.ancho / paso)), ny = Math.max(1, Math.round(terreno.largo / paso));
    const huellas = obstaculos.map(o => ({ ...huella(o), alto: o.altura, techo: o.tipo === 'casa' }))
      .map(h => h.poligono ? { ...h, poligono: antihorario(h.poligono) } : h);
    // Momentos del día cada media hora con el sol a más de 5° (más bajo casi no calienta ni seca)
    const PASO_H = 0.5, momentos = [];
    let luz = 0;
    for (let hora = 4.25; hora < 20; hora += PASO_H) {
      const s = posicion(latitud, dia, hora);
      if (s.altura <= 5) continue;
      luz += PASO_H;
      const r = rad(s.rumbo + norte);
      momentos.push({ dx: Math.sin(r), dy: Math.cos(r), tan: Math.tan(rad(s.altura)) });
    }
    const horas = new Float32Array(nx * ny);
    let sol = 0, media = 0, sombra = 0;
    for (let j = 0; j < ny; j++) {
      const y = (j + 0.5) * terreno.largo / ny;
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * terreno.ancho / nx;
        if (huellas.some(h => h.techo && dentro(h.poligono, x, y))) { horas[j * nx + i] = -1; continue; }
        let n = 0;
        for (const m of momentos) {
          const tapado = huellas.some(h => { const t = entrada(h, x, y, m.dx, m.dy); return t != null && t * m.tan < h.alto; });
          if (!tapado) n++;
        }
        const hs = n * PASO_H;
        horas[j * nx + i] = hs;
        if (hs >= 6) sol++; else if (hs >= 3) media++; else sombra++;
      }
    }
    const total = sol + media + sombra || 1;
    return { nx, ny, horas, luz, sol: sol / total * 100, media: media / total * 100, sombra: sombra / total * 100 };
  }

  // Sol y sombra de lo que riega cada sector (solo los puntos que le llegan a algún aspersor del sector).
  // mezcla = true cuando tiene al menos un 25 % al sol pleno y un 25 % a la sombra: conviene separarlo.
  function porSector(m, terreno, aspersores, riega) {
    const grupos = new Map();
    for (const a of aspersores) { if (!grupos.has(a.s)) grupos.set(a.s, []); grupos.get(a.s).push(a); }
    const res = [];
    for (const [s, asps] of grupos) {
      let sol = 0, media = 0, sombra = 0;
      for (let j = 0; j < m.ny; j++) {
        const y = (j + 0.5) * terreno.largo / m.ny;
        for (let i = 0; i < m.nx; i++) {
          const hs = m.horas[j * m.nx + i];
          if (hs < 0) continue;
          const x = (i + 0.5) * terreno.ancho / m.nx;
          if (!asps.some(a => riega(a, x, y))) continue;
          if (hs >= 6) sol++; else if (hs >= 3) media++; else sombra++;
        }
      }
      const total = sol + media + sombra;
      if (!total) continue;
      const p = { s, sol: sol / total * 100, media: media / total * 100, sombra: sombra / total * 100 };
      p.mezcla = p.sol >= 25 && p.sombra >= 25;
      res.push(p);
    }
    return res.sort((a, b) => a.s - b.s);
  }

  global.SOL = { TIPOS, COPA, EPOCAS, diaDeEpoca, posicion, huella, rectanguloDeTresPuntos, entrada: (h, ...r) => entrada(h.poligono ? { poligono: antihorario(h.poligono) } : h, ...r), mapa, porSector };
})(typeof window !== 'undefined' ? window : globalThis);
