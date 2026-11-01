// Pruebas del cálculo hidráulico. Correr con:  node --test pruebas
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis;
for (const f of ['datos/hunter-2026.js', 'datos/czerweny.js', 'app/calculo.js'])
  vm.runInThisContext(fs.readFileSync(path.join(raiz, f), 'utf8'), { filename: f });
const R = globalThis.RIEGO;

const cerca = (real, esperado, tolPct, msg) =>
  assert.ok(Math.abs(real - esperado) <= Math.abs(esperado) * tolPct / 100, `${msg}: dio ${real}, se esperaba ${esperado} (±${tolPct} %)`);

// Sector base: un solo tramo sin caño, sin válvula, presión fija.
const simple = (emisor, bar, extra = {}) => ({
  fuente: { tipo: 'presion', bar }, valvula: false,
  lateral: { material: 'pead-pn6', nominal: 32 },
  aspersores: [{ emisor, distancia: 0, altura: 0, ...extra }], accesorios: 0,
});

test('Hazen-Williams coincide con las tablas de pérdida de Hunter', () => {
  // [l/min, diámetro interior mm, C, bar cada 100 m según el catálogo, página]
  const casos = [
    [34.1, 22.0, 150, 1.10, 'pág. 215 PVC 25'],
    [34.1, 28.4, 150, 0.32, 'pág. 215 PVC 32'],
    [98.4, 36.2, 150, 0.74, 'pág. 215 PVC 40'],
    [34.1, 21.4, 140, 1.43, 'pág. 219 PEAD 25'],
    [34.1, 28.4, 140, 0.36, 'pág. 219 PEAD 32'],
    [166.6, 44.2, 140, 0.82, 'pág. 219 PEAD 50'],
    [499.7, 66.4, 140, 0.87, 'pág. 219 PEAD 75'],
  ];
  for (const [q, di, C, bar, cual] of casos) cerca(R.perdidaCano(q, 100, di, C), bar, 6, cual);
});

test('interpolación: adentro, abajo y arriba de la tabla (sin extrapolar)', () => {
  const xs = [1, 2, 3], ys = [10, 20, 40];
  assert.deepEqual(R.interpolar(xs, ys, 2.5), { valor: 30, fuera: 0 });
  assert.deepEqual(R.interpolar(xs, ys, 0.5), { valor: 10, fuera: -1 });
  assert.deepEqual(R.interpolar(xs, ys, 4), { valor: 40, fuera: 1 });
  assert.deepEqual(R.interpolar(xs, ys, 3), { valor: 40, fuera: 0 });
});

test('catálogo de aspersores armado desde los datos de Hunter', () => {
  const e = R.emisor('pro-12-180');
  assert.equal(e.presiones[2], 2.1);
  assert.equal(e.caudales[2], 4.87);               // l/min del catálogo (mayor que 0,29 m³/h = 4,83)
  cerca(R.emisor('pro-17-180').caudales[4], 10.667, 0.1, 'boquilla 17 a 3 bar usa m³/h (0,64) y no 10,06 l/min');
  assert.ok(R.emisor('pgp-3.0') && R.emisor('mp-MP2000-360') && R.emisor('pgp-MPR-30-90') && R.emisor('mp-MP-SS-530'));
  // Pro fijas 21 + ajustables (4A y 6A: 14; 8A a 17A-HE: 20) + MP 18 + franjas 3 + PGP 22 + MPR 12
  assert.equal(R.emisores().length, 110);
  const ajustables = [...new Set(R.emisores().filter(e => e.tipo === R.TIPO_AJUSTABLE).map(e => e.boquilla))];
  assert.deepEqual(ajustables, ['4A', '6A', '8A-HE', '10A-HE', '12A-HE', '15A-HE', '17A-HE']);
});

test('boquillas ajustables: cualquier arco, interpolado entre los arcos de la tabla', () => {
  const t = arco => R.emisor(`pro-15A-HE@${arco}`).caudales[2];     // a 2,1 bar
  assert.equal(t(180), 7.08);                                         // pág. 75, valor de tabla
  assert.equal(R.emisor('pro-15A-HE@180').arcoDeTabla, true);
  // a 270° usa 0,64 m³/h = 10,667 l/min (mayor que los 10,62 l/min impresos)
  cerca(t(225), (7.08 + 0.64 * 1000 / 60) / 2, 0.01, '225° queda en la mitad entre 180° y 270°');
  assert.equal(R.emisor('pro-15A-HE@225').arcoDeTabla, false);
  cerca(t(30), t(90) * 30 / 90, 0.01, 'debajo de 90° es proporcional al arco');
  cerca(R.emisor('pro-17A-HE@90').radios[4], 5.4, 0.01, 'alcance 5,4 m (el catálogo imprime 54)');
  assert.throws(() => R.emisor('pro-15A-HE@400'));
  const r = R.calcularSector(simple('pro-15A-HE@225', 2.1));
  assert.ok(r.avisos.some(a => a.nivel === 'info' && a.texto.includes('proporción al arco')));
});

test('un aspersor sin pérdidas recibe la presión de la fuente y da el caudal de la tabla', () => {
  const r = R.calcularSector(simple('pro-15-360', 2.1));
  cerca(r.aspersores[0].presionBoquilla, 2.1, 0.01, 'presión');
  cerca(r.caudalTotal, 14.5, 0.1, 'caudal (0,87 m³/h = 14,5 l/min)');
  cerca(r.aspersores[0].radio, 4.6, 0.1, 'radio');
  assert.equal(r.avisos.length, 0);
});

test('cuerpo PRS30 regula a 2,1 bar y avisa si no le alcanza la presión', () => {
  const r = R.calcularSector(simple('pro-12-360', 3.5, { regulador: 'PRS30' }));
  cerca(r.aspersores[0].presionBoquilla, 2.1, 0.01, 'presión en la boquilla');
  cerca(r.caudalTotal, 9.74, 0.1, 'caudal a 2,1 bar');
  const bajo = R.calcularSector(simple('pro-12-360', 1.5, { regulador: 'PRS30' }));
  assert.ok(bajo.avisos.some(a => a.texto.includes('no llega a regular')));
});

test('presión fuera de tabla: avisa y no extrapola', () => {
  const bajo = R.calcularSector(simple('mp-MP2000-360', 1.5));
  assert.ok(bajo.avisos.some(a => a.nivel === 'error' && a.texto.includes('menos que el mínimo')));
  cerca(bajo.caudalTotal, 4.85, 0.1, 'usa el primer valor de la tabla');
  const alto = R.calcularSector(simple('pro-10-90', 4));
  assert.ok(alto.avisos.some(a => a.texto.includes('regulador')));
});

test('desnivel: 10,2 m más arriba es 1 bar menos', () => {
  const r = R.calcularSector(simple('pgp-3.0', 4, { altura: 10.2 }));
  cerca(r.aspersores[0].presionBoquilla, 3.0, 0.01, 'presión');
});

test('sector de 5 difusores: balance de caudal y presiones coherentes tramo a tramo', () => {
  const sector = {
    fuente: { tipo: 'presion', bar: 3 }, valvula: true,
    alimentacion: { material: 'pead-pn6', nominal: 32, largo: 15, desnivel: 0 },
    lateral: { material: 'pead-pn6', nominal: 25 },
    aspersores: Array.from({ length: 5 }, (_, i) => ({ emisor: 'pro-12-180', distancia: i === 0 ? 2 : 3.7, altura: 0 })),
    accesorios: 10,
  };
  const r = R.calcularSector(sector);
  assert.ok(r.convergio);
  const suma = r.aspersores.reduce((s, a) => s + a.caudal, 0);
  cerca(r.caudalTotal, suma, 0.01, 'el total es la suma de los aspersores');
  cerca(r.tramos[0].caudal, suma, 0.01, 'el primer tramo lleva todo el caudal');
  // Cada presión es la anterior menos la pérdida del tramo, y cada caudal sale de la tabla con esa presión.
  let p = r.presionSalidaValvula;
  r.aspersores.forEach((a, i) => {
    p -= r.tramos[i].perdida;
    cerca(a.presionEntrada, p, 0.01, `presión del aspersor ${a.n}`);
    cerca(a.caudal, R.interpolar(a.emisor.presiones, a.emisor.caudales, a.presionBoquilla).valor, 0.01, `caudal del aspersor ${a.n}`);
    if (i) assert.ok(a.presionEntrada < r.aspersores[i - 1].presionEntrada, 'en terreno plano la presión baja a lo largo del lateral');
  });
  const alim = R.perdidaCano(suma, 15, 28.4, 140) * 1.1;
  cerca(r.presionValvula, 3 - alim, 0.01, 'presión en la válvula');
});

test('bomba: el punto de trabajo cae sobre la curva', () => {
  const sector = {
    fuente: { tipo: 'bomba', linea: 'ZETA', modelo: 'ZETA 1', aspiracion: 0 }, valvula: false,
    lateral: { material: 'pead-pn6', nominal: 32 },
    aspersores: [{ emisor: 'pgp-8.0', distancia: 0, altura: 0 }, { emisor: 'pgp-8.0', distancia: 0, altura: 0 }],
    accesorios: 0,
  };
  const r = R.calcularSector(sector);
  const b = R.bomba('ZETA', 'ZETA 1');
  const h = R.interpolar(b.caudales, b.alturas, r.caudalTotal).valor;
  cerca(r.aspersores[0].presionBoquilla, h / 10.2, 0.05, 'presión = altura de la bomba a ese caudal');
  cerca(r.caudalTotal, 2 * R.interpolar(R.emisor('pgp-8.0').presiones, R.emisor('pgp-8.0').caudales, h / 10.2).valor, 0.05, 'caudal');
});

test('bomba que no alcanza el caudal: avisa', () => {
  const sector = {
    fuente: { tipo: 'bomba', linea: 'QB', modelo: 'QB 60L1', aspiracion: 0 }, valvula: false,
    lateral: { material: 'pead-pn6', nominal: 32 },
    aspersores: Array.from({ length: 6 }, () => ({ emisor: 'pgp-8.0', distancia: 0, altura: 0 })), accesorios: 0,
  };
  const r = R.calcularSector(sector);
  assert.ok(r.avisos.some(a => a.nivel === 'error'));
});

test('diámetro recomendado: con más caudal pide un caño más grande', () => {
  const base = n => ({
    fuente: { tipo: 'presion', bar: 3.5 }, valvula: true,
    lateral: { material: 'pead-pn6', nominal: 25 },
    aspersores: Array.from({ length: n }, (_, i) => ({ emisor: 'pgp-4.0', distancia: i === 0 ? 3 : 11, altura: 0 })),
    accesorios: 10,
  });
  const chico = R.recomendarDiametro(base(2)), grande = R.recomendarDiametro(base(6));
  assert.ok(chico.recomendado && grande.recomendado, 'encuentra un diámetro');
  assert.ok(grande.recomendado > chico.recomendado, `6 turbinas (${grande.recomendado}) > 2 turbinas (${chico.recomendado})`);
  const elegido = grande.opciones.find(o => o.nominal === grande.recomendado);
  assert.ok(elegido.velocidadMax <= 1.5 && elegido.variacion <= 20);
});

test('mezclar difusores con turbinas da aviso', () => {
  const r = R.calcularSector({
    fuente: { tipo: 'presion', bar: 3 }, valvula: false, lateral: { material: 'pead-pn6', nominal: 32 },
    aspersores: [{ emisor: 'pro-12-180', distancia: 1 }, { emisor: 'pgp-3.0', distancia: 5 }], accesorios: 0,
  });
  assert.ok(r.avisos.some(a => a.texto.includes('mezcla')));
});

test('números escritos a la argentina: coma decimal y punto de miles', () => {
  const casos = [['5,12', 5.12], ['5.12', 5.12], ['0,5', 0.5], ['20.000', 20000], ['1.234,5', 1234.5], ['$ 8.500', 8500], [' 3,5 ', 3.5], ['12', 12]];
  for (const [texto, valor] of casos) assert.equal(R.leerNumero(texto), valor, texto);
  assert.ok(Number.isNaN(R.leerNumero('')) && Number.isNaN(R.leerNumero('abc')));
});

test('válvula PGV según caudal y caño: 1" hasta 150 l/min y caño de 40; 1½" con caño de 50 o más caudal; 2" con 63', () => {
  const v = (q, d) => RIEGO.elegirValvula(q, d).medida;
  assert.equal(v(60, 32), '1"');
  assert.equal(v(140, 40), '1"');
  assert.equal(v(60, 50), '1½"');
  assert.equal(v(200, 40), '1½"');
  assert.equal(v(60, 63), '2"');
  assert.equal(v(500, 40), '2"');
});
