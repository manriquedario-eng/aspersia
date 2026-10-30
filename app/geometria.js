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

  // Cuenta cuántos aspersores llegan a cada punto del terreno (una grilla de "paso" metros).
  // Devuelve la grilla y los porcentajes: seco (0), uno solo (1) y bien cubierto (2 o más).
  function cobertura(terreno, aspersores, paso = 0.25) {
    const nx = Math.max(1, Math.round(terreno.ancho / paso)), ny = Math.max(1, Math.round(terreno.largo / paso));
    const cuenta = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      const y = (j + 0.5) * terreno.largo / ny;
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * terreno.ancho / nx;
        let n = 0;
        for (const a of aspersores) if (riega(a, x, y)) { n++; if (n === 255) break; }
        cuenta[j * nx + i] = n;
      }
    }
    let seco = 0, uno = 0;
    for (const c of cuenta) { if (c === 0) seco++; else if (c === 1) uno++; }
    const total = nx * ny;
    return { nx, ny, cuenta, seco: seco / total * 100, uno: uno / total * 100, bien: (total - seco - uno) / total * 100 };
  }

  // Distancias del caño a partir del plano: de la válvula al primer aspersor y de cada uno al siguiente, en línea recta.
  function distanciasDesdePlano(valvula, aspersores) {
    let px = valvula.x, py = valvula.y;
    return aspersores.map(a => {
      const d = Math.hypot(a.x - px, a.y - py);
      px = a.x; py = a.y;
      return Math.round(d * 10) / 10;
    });
  }

  // Ubicación de arranque para los aspersores que todavía no están en el plano:
  // cada sector en una fila, separados según las distancias que ya tenían cargadas.
  function ubicarSinPosicion(terreno, sectores) {
    const filas = sectores.length + 1;
    sectores.forEach((s, k) => {
      const y = Math.round(terreno.largo * (k + 1) / filas * 10) / 10;
      if (!s.valvulaPos) s.valvulaPos = { x: 0.5, y };
      let x = s.valvulaPos.x;
      for (const a of s.aspersores) {
        x = Math.min(terreno.ancho, x + Math.max(0.5, a.distancia || 1));
        if (a.x == null || a.y == null) { a.x = Math.round(x * 10) / 10; a.y = y; }
        if (a.giro == null) a.giro = 0;
      }
    });
  }

  // Escala del plano a partir de una medida conocida: dos puntos (en los metros actuales del plano) y su largo real.
  // Devuelve el factor por el que hay que multiplicar todo para que esa distancia mida lo que dice el usuario.
  function factorDeEscala(a, b, metrosReales) {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(d > 0) || !(metrosReales > 0)) throw new Error('Marcá dos puntos distintos y escribí cuántos metros hay entre ellos.');
    return metrosReales / d;
  }

  // Aplica un factor de escala a todo el plano: terreno, imagen de fondo, fuente, válvulas y aspersores.
  // Todo se multiplica desde la esquina de abajo a la izquierda, así cada cosa queda sobre el mismo lugar de la imagen.
  function escalarPlano(plano, sectores, k) {
    const r1 = v => Math.round(v * 100) / 100;
    plano.ancho = r1(plano.ancho * k);
    plano.largo = r1(plano.largo * k);
    if (plano.fondo) { plano.fondo.ancho *= k; plano.fondo.alto *= k; }
    const mover = p => { if (p && p.x != null) { p.x = r1(p.x * k); p.y = r1(p.y * k); } };
    mover(plano.fuente);
    for (const s of sectores) { mover(s.valvulaPos); s.aspersores.forEach(mover); }
  }

  global.GEOMETRIA = { rumbo, difAngulo, riega, cobertura, distanciasDesdePlano, ubicarSinPosicion, factorDeEscala, escalarPlano };
})(typeof window !== 'undefined' ? window : globalThis);
