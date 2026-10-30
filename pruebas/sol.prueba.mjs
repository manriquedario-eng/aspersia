// Pruebas del sol y las sombras. Correr con:  node --test pruebas/*.prueba.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis;
for (const f of ['app/geometria.js', 'app/sol.js']) vm.runInThisContext(fs.readFileSync(path.join(raiz, f), 'utf8'));
const { SOL: S, GEOMETRIA: G } = globalThis;
const cerca = (a, b, tol, txt) => assert.ok(Math.abs(a - b) <= tol, `${txt}: ${a} y se esperaba ${b}`);
const LAT = -34.6;   // Buenos Aires

test('posición del sol en Buenos Aires: al mediodía está al norte, y más alto en verano', () => {
  const v = S.posicion(LAT, S.diaDeEpoca('verano', LAT), 12);
  const e = S.posicion(LAT, S.diaDeEpoca('intermedia', LAT), 12);
  const i = S.posicion(LAT, S.diaDeEpoca('invierno', LAT), 12);
  cerca(v.altura, 90 - 34.6 + 23.44, 0.5, 'verano'); cerca(e.altura, 90 - 34.6, 0.6, 'equinoccio'); cerca(i.altura, 90 - 34.6 - 23.44, 0.5, 'invierno');
  for (const p of [v, e, i]) assert.ok(p.rumbo < 1 || p.rumbo > 359, `al norte: ${p.rumbo}`);
  cerca(S.posicion(LAT, 80, 6.5).rumbo, 90, 8, 'a la mañana sale por el este');
  cerca(S.posicion(LAT, 80, 17.5).rumbo, 270, 8, 'a la tarde se pone por el oeste');
  assert.equal(S.diaDeEpoca('verano', 40), 172, 'en el hemisferio norte el verano es en junio');
});

// Medianera de 2 m de este a oeste en el medio de un terreno de 10 × 10 m, con el norte arriba.
const muro = { tipo: 'muro', puntos: [{ x: 0, y: 5 }, { x: 10, y: 5 }], altura: 2 };
const horasEn = (m, t, x, y) => m.horas[Math.floor(y / t.largo * m.ny) * m.nx + Math.floor(x / t.ancho * m.nx)];

test('sombra de un muro: en invierno el lado sur queda a la sombra y el norte al sol', () => {
  const t = { ancho: 10, largo: 10 };
  const m = S.mapa(t, [muro], { latitud: LAT, norte: 0, epoca: 'invierno' }, 0.25);
  assert.ok(horasEn(m, t, 5, 4.4) < 3, `pegado al sur del muro: ${horasEn(m, t, 5, 4.4)} h`);
  assert.ok(horasEn(m, t, 5, 8) >= 6, `al norte: ${horasEn(m, t, 5, 8)} h`);
  cerca(horasEn(m, t, 5, 8), m.luz, 0.01, 'al norte del muro nada le tapa el sol');
  // En verano el sol está más alto: la sombra es más corta y el mismo punto recibe más sol.
  const v = S.mapa(t, [muro], { latitud: LAT, norte: 0, epoca: 'verano' }, 0.25);
  assert.ok(horasEn(v, t, 5, 3) > horasEn(m, t, 5, 3), 'más sol en verano');
  // Con el norte para abajo, se da vuelta: la sombra cae del lado de arriba del plano.
  const g = S.mapa(t, [muro], { latitud: LAT, norte: 180, epoca: 'invierno' }, 0.25);
  assert.ok(horasEn(g, t, 5, 5.6) < 3 && horasEn(g, t, 5, 2) >= 6, 'norte girado');
});

test('casa marcada con tres toques: rectángulo girado, adentro es techo', () => {
  const pts = S.rectanguloDeTresPuntos({ x: 2, y: 2 }, { x: 6, y: 6 }, { x: 3, y: 7 });   // casa girada 45°
  assert.equal(pts.length, 4);
  cerca(Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y), Math.hypot(1, 5) * Math.sin(Math.atan2(5, 1) - Math.PI / 4), 0.02, 'fondo');
  const t = { ancho: 12, largo: 12 };
  const m = S.mapa(t, [{ tipo: 'casa', puntos: pts, altura: 3 }], { latitud: LAT, epoca: 'verano' }, 0.25);
  assert.equal(horasEn(m, t, 4, 4.5), -1, 'bajo techo');
  assert.throws(() => S.rectanguloDeTresPuntos({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 3, y: 3 }));
  assert.throws(() => S.rectanguloDeTresPuntos({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 8, y: 0 }));
});

test('árbol: hace sombra a su alrededor, más hacia el sur', () => {
  const t = { ancho: 12, largo: 12 };
  const m = S.mapa(t, [{ tipo: 'arbol', x: 6, y: 6, radio: 3, altura: 6 }], { latitud: LAT, epoca: 'invierno' }, 0.25);
  assert.ok(horasEn(m, t, 6, 2) < horasEn(m, t, 6, 10.5), 'el sur del árbol tiene menos sol que el norte');
  assert.ok(S.entrada({ circulo: { x: 0, y: 0, r: 1 } }, -3, 0, 1, 0) === 2 && S.entrada({ circulo: { x: 0, y: 0, r: 1 } }, -3, 0, -1, 0) === null);
});

test('por sector: avisa cuando un sector riega mitad al sol y mitad a la sombra', () => {
  const t = { ancho: 10, largo: 10 };
  const m = S.mapa(t, [muro], { latitud: LAT, norte: 0, epoca: 'invierno' }, 0.25);
  const asps = [
    { s: 0, x: 5, y: 5.1, radio: 3, arco: 360, giro: 0 },     // sector 0: encima del muro, riega a los dos lados
    { s: 1, x: 5, y: 9, radio: 1, arco: 360, giro: 0 },       // sector 1: todo al norte, al sol
  ];
  const r = S.porSector(m, t, asps, G.riega);
  assert.equal(r[0].mezcla, true, JSON.stringify(r[0]));
  assert.equal(r[1].mezcla, false);
  cerca(r[1].sol, 100, 0.01, 'sector al sol');
});

test('escalar el plano mueve también lo que hace sombra', () => {
  const plano = { ancho: 10, largo: 10, fuente: { x: 1, y: 1 }, sombras: [
    { tipo: 'muro', puntos: [{ x: 1, y: 2 }, { x: 3, y: 2 }], altura: 2 }, { tipo: 'arbol', x: 4, y: 4, radio: 3, altura: 6 }] };
  G.escalarPlano(plano, [], 2);
  assert.deepEqual(plano.sombras[0].puntos, [{ x: 2, y: 4 }, { x: 6, y: 4 }]);
  assert.deepEqual([plano.sombras[1].x, plano.sombras[1].y, plano.sombras[1].radio, plano.sombras[1].altura], [8, 8, 3, 6]);
});
