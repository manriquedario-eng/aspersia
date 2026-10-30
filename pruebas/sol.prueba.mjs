// Pruebas del lado del sol. Correr con:  node --test pruebas/*.prueba.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(raiz, 'app/sol.js'), 'utf8'));
const S = globalThis.SOL;

test('degradé de sol: va del borde norte (más sol) al borde sur del terreno', () => {
  const t = { ancho: 20, largo: 10 };
  assert.deepEqual(S.degradeSol(t, 0), { norte: { x: 10, y: 10 }, sur: { x: 10, y: 0 } }, 'norte arriba');
  assert.deepEqual(S.degradeSol(t, 90), { norte: { x: 20, y: 5 }, sur: { x: 0, y: 5 } }, 'norte a la derecha');
  assert.deepEqual(S.degradeSol(t, 180), { norte: { x: 10, y: 0 }, sur: { x: 10, y: 10 } }, 'norte abajo');
  const d = S.degradeSol(t, 45);   // en diagonal, de esquina a esquina
  assert.ok(d.norte.x > 10 && d.norte.y > 5 && d.sur.x < 10 && d.sur.y < 5);
});

test('lado del plano para los textos', () => {
  assert.equal(S.ladoDelPlano(0), 'arriba');
  assert.equal(S.ladoDelPlano(90), 'la derecha');
  assert.equal(S.ladoDelPlano(180), 'abajo');
  assert.equal(S.ladoDelPlano(270), 'la izquierda');
  assert.equal(S.ladoDelPlano(360 + 45), 'arriba a la derecha');
  assert.equal(S.ladoDelPlano(-90), 'la izquierda');
});
