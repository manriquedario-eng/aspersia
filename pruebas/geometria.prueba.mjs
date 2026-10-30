// Pruebas de la geometría del plano. Correr con:  node --test pruebas/*.prueba.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(raiz, 'app/geometria.js'), 'utf8'));
const G = globalThis.GEOMETRIA;

test('rumbos: 0° arriba y crece en el sentido de las agujas del reloj', () => {
  assert.equal(G.rumbo(0, 1), 0);
  assert.equal(G.rumbo(1, 0), 90);
  assert.equal(G.rumbo(0, -1), 180);
  assert.equal(G.rumbo(-1, 0), 270);
  assert.equal(G.difAngulo(350, 10), 20);
  assert.equal(G.difAngulo(90, 270), 180);
});

test('abanico: radio y arco', () => {
  const a = { x: 0, y: 0, radio: 4, arco: 90, giro: 45 };     // cuarto de círculo apuntando al noreste
  assert.ok(G.riega(a, 2, 2));
  assert.ok(G.riega(a, 0.1, 3.9));                               // borde del arco, dentro del radio
  assert.ok(!G.riega(a, 3.5, 3.5), 'fuera del radio');
  assert.ok(!G.riega(a, -1, 1), 'fuera del arco');
  assert.ok(!G.riega(a, 1, -1), 'fuera del arco');
  const circulo = { x: 5, y: 5, radio: 2, arco: 360, giro: 0 };
  assert.ok(G.riega(circulo, 3.1, 5) && G.riega(circulo, 6.9, 5) && !G.riega(circulo, 7.1, 5));
  const medio = { x: 0, y: 0, radio: 3, arco: 180, giro: 90 };   // medio círculo hacia la derecha
  assert.ok(G.riega(medio, 1, 2.5) && G.riega(medio, 1, -2.5) && !G.riega(medio, -0.5, 0));
});

test('franjas MP: lateral centrada y esquinas', () => {
  const ss = { x: 0, y: 0, franja: 'SS', ancho: 1.5, radio: 9, giro: 0 };   // tira hacia arriba, 9 m de largo
  assert.ok(G.riega(ss, 4, 1) && G.riega(ss, -4, 1) && !G.riega(ss, 5, 1) && !G.riega(ss, 0, 2));
  const izq = { x: 0, y: 0, franja: 'LCS', ancho: 1.5, radio: 4.5, giro: 0 };
  assert.ok(G.riega(izq, -3, 1) && !G.riega(izq, 1, 1));
  const der = { x: 0, y: 0, franja: 'RCS', ancho: 1.5, radio: 4.5, giro: 0 };
  assert.ok(G.riega(der, 3, 1) && !G.riega(der, -1, 1));
});

test('cobertura: cuatro aspersores en las esquinas, cabeza a cabeza, cubren todo con superposición', () => {
  const t = { ancho: 5, largo: 5 };
  const esquinas = [[0, 0, 45], [5, 0, 315], [5, 5, 225], [0, 5, 135]].map(([x, y, giro]) => ({ x, y, giro, arco: 90, radio: 5 }));
  const c = G.cobertura(t, esquinas, 0.25);
  assert.equal(c.seco, 0);
  assert.ok(c.bien > 99, `bien cubierto: ${c.bien}`);
});

test('cobertura: un solo aspersor en el medio deja las esquinas secas', () => {
  const c = G.cobertura({ ancho: 10, largo: 10 }, [{ x: 5, y: 5, giro: 0, arco: 360, radio: 5 }], 0.25);
  // área del círculo / área del cuadrado = π·25 / 100 ≈ 78,5 % con un solo aspersor
  assert.ok(Math.abs(c.uno - 78.5) < 1.5, `uno solo: ${c.uno}`);
  assert.ok(Math.abs(c.seco - 21.5) < 1.5, `seco: ${c.seco}`);
  assert.equal(c.bien, 0);
});

test('distancias del caño desde el plano', () => {
  const d = G.distanciasDesdePlano({ x: 0, y: 0 }, [{ x: 3, y: 4 }, { x: 3, y: 10 }, { x: 0, y: 10 }]);
  assert.deepEqual(d, [5, 6, 3]);
});

test('escala con una medida conocida: todo el plano se agranda junto con la imagen', () => {
  // En la captura sin escalar, el frente del lote mide 4 "metros"; en la realidad mide 12 m → factor 3
  const k = G.factorDeEscala({ x: 1, y: 2 }, { x: 5, y: 2 }, 12);
  assert.equal(k, 3);
  const plano = { ancho: 10, largo: 6, fuente: { x: 1, y: 1 }, fondo: { ancho: 10, alto: 6 } };
  const sectores = [{ valvulaPos: { x: 2, y: 1 }, aspersores: [{ x: 4, y: 3, giro: 90 }, { x: 8.5, y: 5.5 }] }];
  G.escalarPlano(plano, sectores, k);
  assert.deepEqual([plano.ancho, plano.largo, plano.fondo.ancho, plano.fondo.alto], [30, 18, 30, 18]);
  assert.deepEqual(plano.fuente, { x: 3, y: 3 });
  assert.deepEqual(sectores[0].valvulaPos, { x: 6, y: 3 });
  assert.deepEqual(sectores[0].aspersores.map(a => [a.x, a.y]), [[12, 9], [25.5, 16.5]]);
  assert.equal(sectores[0].aspersores[0].giro, 90, 'el giro no cambia');
  assert.throws(() => G.factorDeEscala({ x: 1, y: 1 }, { x: 1, y: 1 }, 5));
  assert.throws(() => G.factorDeEscala({ x: 0, y: 0 }, { x: 1, y: 1 }, 0));
});

test('ubicación de arranque: respeta las distancias y no pisa lo ya ubicado', () => {
  const sectores = [
    { aspersores: [{ distancia: 2 }, { distancia: 3.7 }, { x: 9, y: 9, giro: 30, distancia: 3 }] },
    { aspersores: [{ distancia: 5 }] },
  ];
  G.ubicarSinPosicion({ ancho: 20, largo: 15 }, sectores);
  assert.deepEqual([sectores[0].aspersores[0].x, sectores[0].aspersores[1].x], [2.5, 6.2]);
  assert.deepEqual([sectores[0].aspersores[2].x, sectores[0].aspersores[2].y, sectores[0].aspersores[2].giro], [9, 9, 30]);
  assert.ok(sectores[0].valvulaPos && sectores[1].valvulaPos);
  assert.notEqual(sectores[0].aspersores[0].y, sectores[1].aspersores[0].y, 'cada sector en su fila');
});
