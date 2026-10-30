// Lado del sol en el terreno: en Argentina (hemisferio sur) el sol pasa por el norte, así que el lado norte
// del terreno recibe más sol y el lado sur, menos. Se muestra como un degradé suave, orientativo.
// Mismas coordenadas que GEOMETRIA: metros, x a la derecha, y hacia arriba; rumbos 0° arriba y en el sentido del reloj.
// "norte" es el rumbo hacia donde está el norte en el plano (0 = arriba, como las capturas de Google Maps).

(function (global) {
  // Puntas del degradé (en metros del plano): la del borde norte del terreno (más sol) y la del borde sur (menos sol).
  function degradeSol(terreno, norte = 0) {
    const r = norte * Math.PI / 180, dx = Math.sin(r), dy = Math.cos(r);
    const cx = terreno.ancho / 2, cy = terreno.largo / 2;
    const medio = (Math.abs(dx) * terreno.ancho + Math.abs(dy) * terreno.largo) / 2;
    const r2 = v => Math.round(v * 100) / 100 + 0;   // + 0: que no quede "-0"
    return { norte: { x: r2(cx + dx * medio), y: r2(cy + dy * medio) }, sur: { x: r2(cx - dx * medio), y: r2(cy - dy * medio) } };
  }

  // Lado del plano hacia donde apunta un rumbo, para los textos ("arriba", "la derecha"…).
  const LADOS = ['arriba', 'arriba a la derecha', 'la derecha', 'abajo a la derecha', 'abajo', 'abajo a la izquierda', 'la izquierda', 'arriba a la izquierda'];
  const ladoDelPlano = rumbo => LADOS[Math.round((((rumbo % 360) + 360) % 360) / 45) % 8];

  global.SOL = { degradeSol, ladoDelPlano };
})(typeof window !== 'undefined' ? window : globalThis);
