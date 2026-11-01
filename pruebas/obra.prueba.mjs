// Prueba de una obra completa, de punta a punta: diseño → cálculo → plano → presupuesto → cierre → PDF → copia de seguridad.
// Controla que todas las partes de la app digan lo mismo. Correr con:  node --test pruebas/*.prueba.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis;
// El PDF lee el logo con fetch y FileReader (del navegador): acá se leen del disco.
globalThis.fetch = async () => ({ blob: async () => new Blob([fs.readFileSync(path.join(raiz, 'app/marca/logo-pdf.png'))], { type: 'image/png' }) });
globalThis.FileReader = class { readAsDataURL(b) { b.arrayBuffer().then(ab => { this.result = 'data:image/png;base64,' + Buffer.from(ab).toString('base64'); this.onload(); }); } };
for (const f of ['datos/hunter-2026.js', 'datos/czerweny.js', 'app/calculo.js', 'app/presupuesto.js', 'app/almacen.js', 'app/geometria.js', 'app/obra.js',
  'app/vendor/jspdf-2.5.1.umd.min.js', 'app/vendor/jspdf-autotable-3.8.2.min.js', 'app/pdf.js'])
  vm.runInThisContext(fs.readFileSync(path.join(raiz, f), 'utf8'), { filename: f });
const { RIEGO: R, OBRA: O, PRESUPUESTO: P, ALMACEN: A, GEOMETRIA: G, PDF } = globalThis;

// Una obra como la arma la pantalla: aspersores con tipo, boquilla y arco (no con el id del cálculo).
function obraDePrueba() {
  const datos = { siguienteNumero: 12, precios: {} };
  const o = A.obraNueva(datos);
  o.nombre = 'Casa Pérez';
  o.cliente.nombre = 'Juan Pérez';
  o.fuente = { tipo: 'bomba', linea: 'ZETA', modelo: 'ZETA 3', aspiracion: 1 };
  o.sectores = [
    { ...A.sectorNuevo(1), nombre: 'Frente', superficie: 0, aspersores: [
      { tipo: 'MP Rotator', boquilla: 'MP2000', arco: 120, regulador: 'PRS40', distancia: 2, altura: 0, manguera: 1 },
      { tipo: 'MP Rotator', boquilla: 'MP2000', arco: 180, regulador: 'PRS40', distancia: 5, altura: 0, manguera: 2 },
      { tipo: 'Boquilla Pro ajustable', boquilla: '12A-HE', arco: 200, regulador: 'PRS30', distancia: 4, altura: 0, manguera: 1.5 },
    ] },
    { ...A.sectorNuevo(2), nombre: 'Fondo', superficie: 160, lateral: { material: 'pead-pn6', nominal: 32, escalonado: false }, aspersores: [
      { tipo: 'Turbina PGP Ultra', boquilla: '3.0', arco: 180, regulador: '', distancia: 3, altura: 0, manguera: 1 },
      { tipo: 'Turbina PGP Ultra con boquilla MPR', boquilla: 'MPR-30', arco: 90, regulador: '', distancia: 9, altura: 0, manguera: 0 },
    ] },
  ];
  return { o, datos };
}

test('cada aspersor de la pantalla se convierte en el aspersor correcto del cálculo', () => {
  const { o } = obraDePrueba();
  const ids = o.sectores.flatMap(s => s.aspersores.map(O.idEmisor));
  assert.deepEqual(ids, ['mp-MP2000@120', 'mp-MP2000@180', 'pro-12A-HE@200', 'pgp-3.0', 'pgp-MPR-30-90']);
  for (const id of ids) assert.ok(R.emisor(id), id);
});

test('MP Rotator: arco libre dentro de lo que permite cada modelo', () => {
  const q = (id, i = 2) => R.emisor(id).caudales[i];      // a 2,8 bar
  assert.ok(q('mp-MP2000@120') > q('mp-MP2000@90') && q('mp-MP2000@120') < q('mp-MP2000@180'), 'interpola entre 90° y 180°');
  assert.equal(R.emisor('mp-MP2000@180').arcoDeTabla, true);
  assert.equal(R.emisor('mp-MP2000@120').arcoDeTabla, false);
  assert.throws(() => R.emisor('mp-MP2000@300'), /90° a 270°/);
  assert.throws(() => R.emisor('mp-MP2000@60'));
  assert.throws(() => R.emisor('mp-MP3500@270'), /90° a 210°/);
  assert.ok(R.emisor('mp-MP1000@360'));
});

test('cálculo: todos los sectores calculan y el caudal es la suma de sus aspersores', () => {
  const { o } = obraDePrueba();
  for (const s of o.sectores) {
    const c = O.calcular(o, s);
    assert.ok(!c.error, c.error);
    assert.ok(c.r.convergio);
    const suma = c.r.aspersores.reduce((t, a) => t + a.caudal, 0);
    assert.ok(Math.abs(c.r.caudalTotal - suma) < 1e-6);
    assert.equal(c.r.aspersores.length, s.aspersores.length);
  }
});

test('plano: las distancias del plano llegan al cálculo y al presupuesto', () => {
  const { o, datos } = obraDePrueba();
  // Bomba en (-0,5; 3): las válvulas quedan a su salida, una cada 0,5 m (colector), en (0; 3) y (0,5; 3)
  o.plano = { ancho: 20, largo: 12, fuente: { x: -0.5, y: 3 }, distanciasDesdePlano: true, verCobertura: true };
  [[3, 4], [3, 10], [9, 10]].forEach(([x, y], i) => Object.assign(o.sectores[0].aspersores[i], { x, y, giro: 90 }));
  [[4, 4], [10, 4]].forEach(([x, y], i) => Object.assign(o.sectores[1].aspersores[i], { x, y, giro: 0 }));
  O.sincronizarDistancias(o);
  assert.deepEqual([o.sectores[0].valvulaPos, o.sectores[1].valvulaPos], [{ x: 0, y: 3 }, { x: 0.5, y: 3 }]);
  // Frente: válvula (0;3) → (3;4) = √10 ≈ 3,2 m; → (3;10) = 6 m; → (9;10) = 6 m. Fondo: (0,5;3) → (4;4) ≈ 3,6 m; → (10;4) = 6 m.
  assert.deepEqual(o.sectores[0].aspersores.map(a => a.distancia), [3.2, 6, 6]);
  assert.deepEqual(o.sectores[1].aspersores.map(a => a.distancia), [3.6, 6]);
  assert.equal(o.sectores[0].alimentacion.largo, 0.5);
  assert.equal(o.sectores[1].alimentacion.largo, 1);
  // El cálculo usa esos tramos
  const c = O.calcular(o, o.sectores[0]);
  assert.deepEqual(c.r.tramos.map(t => t.largo), [3.2, 6, 6]);
  // El presupuesto cuenta esos metros, cada material y diámetro por separado (+10 % de desperdicio)
  const m = P.materialesDeObra(o, O.paraCalcular(o));
  const q = clave => m.renglones.find(r => r.clave === clave).cantidad;
  assert.equal(q('cano-pvc-k6-32'), Math.ceil(15.2 * 1.1));     // ramal del Frente (PVC K6 32)
  assert.equal(q('cano-pead-pn6-32'), Math.ceil(9.6 * 1.1));    // ramal del Fondo (PEAD 32)
  assert.equal(q('cano-pvc-k6-40'), Math.ceil(1 * 1.1));        // colector a la salida de la bomba: 1 m para 2 válvulas
  // El plano dibuja cada aspersor con el mismo alcance que dio el cálculo
  const dibujo = O.aspersoresDelPlano(o);
  assert.equal(dibujo.length, 5);
  c.r.aspersores.forEach((a, i) => assert.equal(dibujo[i].radio, a.radio));
  assert.equal(dibujo[0].arco, 120, 'la MP lleva el arco elegido');
  assert.equal(dibujo[3].trayectoria, 25, 'PGP estándar: 25°');
  assert.equal(dibujo[2].trayectoria, 25, '12A-HE: 25° (pág. 74)');
  // La cobertura usa esos mismos aspersores
  const cob = G.cobertura(o.plano, dibujo);
  assert.ok(Math.abs(cob.seco + cob.uno + cob.bien - 100) < 1e-6);
});

test('manguera: cada aspersor pierde en su manguera sin afectar a los demás, y avisa pasados los 6 m', () => {
  const { o } = obraDePrueba();
  const c = O.calcular(o, o.sectores[0]);
  for (const a of c.r.aspersores) {
    const esperado = R.perdidaCano(a.caudal, a.manguera + R.ACCESORIOS_MANGUERA_M, R.MANGUERAS['pe-12'].di, R.MANGUERAS['pe-12'].C);
    assert.ok(Math.abs(a.presionCano - a.presionEntrada - esperado) < 1e-3, `pérdida en la manguera del aspersor ${a.n}`);
  }
  // La presión del caño en un aspersor no depende de la manguera de los anteriores: solo de lo que pasa por el caño.
  const sinManguera = O.calcular({ ...o }, { ...o.sectores[0], aspersores: o.sectores[0].aspersores.map(a => ({ ...a, manguera: 0 })) });
  assert.ok(sinManguera.r.aspersores[2].presionCano < c.r.aspersores[2].presionCano + 0.05, 'mismo orden de presión en el caño');
  o.sectores[0].aspersores[0].manguera = 8;
  assert.ok(O.calcular(o, o.sectores[0]).r.avisos.some(a => a.texto.includes('más de los 6 m')));
});

test('presupuesto: materiales coherentes con el diseño', () => {
  const { o, datos } = obraDePrueba();
  const pre = O.presupuesto(o, datos.precios);
  const q = clave => pre.renglones.find(r => r.clave === clave)?.cantidad;
  assert.equal(q('cuerpo-prs40'), 2);
  assert.equal(q('cuerpo-prs30'), 1);
  assert.equal(q('boq-mp-MP2000-90° a 210°'), 2, 'las dos MP de 120° y 180° son la misma boquilla (rango 90° a 210°)');
  assert.equal(q('boq-proaj-12A-HE'), 1);
  assert.equal(q('turbina-pgp-ultra'), 2);
  assert.equal(q('boq-MPR-30-90'), 1);
  assert.equal(q('valvula-pgv-1'), 2);
  assert.equal(q('programador-2'), 1);
  // Conexión al caño: 4 con manguera (conector inicial + espiga) y la turbina con MPR directo al caño
  assert.equal(q('conector-inicial-pe-12'), 4);
  assert.equal(q('espiga-l-pe-12-½"'), 3, 'MP y ajustable: cuerpo Pro-Spray de ½"');
  assert.equal(q('espiga-l-pe-12-¾"'), 1, 'PGP Ultra: entrada de ¾"');
  assert.equal(q('conexion-aspersor'), 1);
  assert.equal(q('manguera-pe-12'), Math.ceil((1 + 2 + 1.5 + 1) * 1.1));
  assert.equal(q('tapon-pvc-k6-32'), 1);
  assert.equal(q('tapon-pead-pn6-32'), 1);
  assert.equal(q('pegamento-pvc'), 1);
  assert.equal(q('bomba-ZETA-ZETA 3'), 1);
  // m²: Fondo cargado (160) + Frente estimado con el alcance real de cada aspersor
  const cFrente = O.calcular(o, o.sectores[0]);
  const estimado = P.superficieEstimada(cFrente.r, o.sectores[0].aspersores);
  assert.equal(q('mo-m2'), Math.round(estimado + 160));
  assert.equal(pre.datos.aspersores, 5);
  assert.deepEqual(pre.datos.sectores, [{ nombre: 'Frente', aspersores: 3 }, { nombre: 'Fondo', aspersores: 2 }]);
});

test('presupuesto cerrado: no cambia con el diseño ni con los precios, y el PDF tampoco', async () => {
  const { o, datos } = obraDePrueba();
  datos.precios = { 'mo-m2': 3000, 'turbina-pgp-ultra': 40000, 'cuerpo-prs40': 15000 };
  o.presupuesto.descuento = 10;
  const antes = O.presupuesto(o, datos.precios);
  o.presupuesto.congelado = { ...antes, fechaCierre: '2026-10-30' };
  o.estado = 'Enviado';
  // Cambios después de enviar
  o.sectores.push({ ...A.sectorNuevo(3), nombre: 'Lateral' });
  o.sectores[0].nombre = 'Otro nombre';
  datos.precios['mo-m2'] = 9999;
  o.presupuesto.descuento = 50;
  const despues = O.presupuesto(o, datos.precios);
  assert.equal(despues.total, antes.total);
  assert.equal(despues.descuentoPct, 10);
  // El PDF sale con lo cerrado: los dos sectores originales, con sus nombres de entonces, y el descuento del 10 %
  const blob = await PDF.armarPDF(o, despues, { comercial: 'Aspersia', nombre: 'Darío' });
  // Dentro del PDF los paréntesis del texto van escapados con "\": se sacan para buscar.
  const texto = Buffer.from(await blob.arrayBuffer()).toString('latin1').replace(/\\([()])/g, '$1');
  assert.ok(texto.includes('2 sectores (Frente (3), Fondo (2))'), 'resumen de los sectores al momento de enviar');
  assert.ok(!texto.includes('Lateral') && !texto.includes('Otro nombre'));
  assert.ok(texto.includes('Descuento 10 %'));
  assert.ok(texto.includes(P.pesos(antes.total)), 'el total del PDF es el del presupuesto');
  assert.ok(blob.size < 400 * 1024, `PDF liviano para WhatsApp: ${Math.round(blob.size / 1024)} KB`);
});

test('copia de seguridad: lo que se guarda es lo que se recupera', async () => {
  const { o, datos } = obraDePrueba();
  const todo = { version: 3, instalador: { nombre: 'Darío' }, precios: { 'mo-m2': 3000 }, siguienteNumero: datos.siguienteNumero, obras: [o] };
  const texto = await A.exportar(todo).text();
  const vuelta = A.importar(texto);
  assert.deepEqual(vuelta.obras[0].sectores, o.sectores);
  assert.deepEqual(vuelta.precios, todo.precios);
  assert.equal(vuelta.siguienteNumero, 113, 'numeración desde 101');
  assert.throws(() => A.importar('{"hola":1}'), /no es una copia de seguridad/);
});

test('guardado: lo de localStorage pasa a IndexedDB una sola vez, sin perder nada, y libera ese lugar', async () => {
  // localStorage e IndexedDB de mentira, con lo mínimo que usa almacen.js
  const ls = new Map();
  globalThis.localStorage = { getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) };
  const tablas = new Map();
  const asinc = (req, fn) => setTimeout(() => { try { req.result = fn(); req.onsuccess?.(); } catch (e) { req.error = e; req.onerror?.(); } });
  globalThis.indexedDB = { open() {
    const req = {};
    const db = { createObjectStore: n => tablas.set(n, new Map()), transaction(n) {
      const tx = { objectStore: () => ({
        get: k => { const r = {}; asinc(r, () => structuredClone(tablas.get(n).get(k))); return r; },
        put: (v, k) => { tablas.get(n).set(k, structuredClone(v)); setTimeout(() => tx.oncomplete?.()); },
      }) };
      return tx;
    } };
    setTimeout(() => { req.result = db; if (!tablas.size) req.onupgradeneeded?.(); req.onsuccess?.(); });
    return req;
  } };
  try {
    const { o } = obraDePrueba();
    o.plano.fondo = { imagen: 'data:image/jpeg;base64,AAAA', ancho: 30, alto: 20, opacidad: 70 };
    ls.set('aspersia.datos.v3', JSON.stringify({ version: 3, instalador: {}, precios: { x: 1 }, siguienteNumero: 5, obras: [o] }));
    const d1 = await A.abrir();
    assert.equal(d1.obras[0].plano.fondo.ancho, 30, 'la foto pasó');
    assert.equal(ls.has('aspersia.datos.v3'), false, 'se liberó localStorage');
    d1.precios.x = 2;
    assert.equal(await A.guardar(d1), true);
    const d2 = await A.abrir();   // como si se volviera a abrir la app
    assert.equal(d2.precios.x, 2);
    assert.deepEqual(d2.obras[0].sectores, o.sectores);
    assert.equal(await A.guardarAparte('antes-de-recuperar', d2), true);
    assert.equal(tablas.get('datos').get('antes-de-recuperar').siguienteNumero, 105);
    assert.equal(A.diasDesde(A.hoy()), 0);
  } finally { delete globalThis.indexedDB; delete globalThis.localStorage; }
});

test('arco: el que se elige (en Diseño o en el plano) es el que dibuja el plano, y el giro no lo cambia', () => {
  const { o } = obraDePrueba();
  o.sectores = [{ ...A.sectorNuevo(1), aspersores: [
    { tipo: 'Boquilla Pro fija', boquilla: '12', arco: 180, regulador: 'PRS30', distancia: 2, altura: 0, manguera: 1, x: 2, y: 2, giro: 0 },
    { tipo: 'Boquilla Pro ajustable', boquilla: '12A-HE', arco: 200, regulador: 'PRS30', distancia: 3, altura: 0, manguera: 1, x: 5, y: 2, giro: 0 },
    { tipo: 'MP Rotator', boquilla: 'MP2000', arco: 180, regulador: 'PRS40', distancia: 3, altura: 0, manguera: 1, x: 8, y: 2, giro: 0 },
  ] }];
  const arcos = () => O.aspersoresDelPlano(o).map(a => a.arco);
  assert.deepEqual(arcos(), [180, 200, 180]);
  const [fija, ajustable, mp] = o.sectores[0].aspersores;
  fija.arco = 90; ajustable.arco = 45; mp.arco = 270;
  assert.deepEqual(arcos(), [90, 45, 270]);
  for (const a of o.sectores[0].aspersores) a.giro = 90;
  assert.deepEqual(arcos(), [90, 45, 270], 'girar no cambia cuánto abre');
  assert.ok(O.aspersoresDelPlano(o).every(a => a.giro === 90));
  // Un arco que la MP no admite: no se dibuja (y la pantalla avisa), pero no rompe a los demás
  mp.arco = 300;
  assert.deepEqual(arcos(), [90, 45]);
});

test('grados libres: la fija que no trae ese arco pasa a la ajustable del mismo tamaño; MP y MPR respetan lo de Hunter', () => {
  const fija = { tipo: 'Boquilla Pro fija', boquilla: '12', arco: 180 };
  assert.equal(O.ponerArco(fija, 90), null);
  assert.deepEqual([fija.tipo, fija.boquilla, fija.arco], ['Boquilla Pro fija', '12', 90], 'la 12 viene en 90°: sigue fija');
  const aviso = O.ponerArco(fija, 45);
  assert.match(aviso, /12A-HE/);
  assert.deepEqual([fija.tipo, fija.boquilla, fija.arco], ['Boquilla Pro ajustable', '12A-HE', 45]);
  assert.ok(R.emisor(O.idEmisor(fija)), 'la ajustable a 45° se puede calcular');
  const aj = { tipo: 'Boquilla Pro ajustable', boquilla: '8A-HE', arco: 180 };
  O.ponerArco(aj, 125);
  assert.equal(aj.arco, 125);
  assert.throws(() => O.ponerArco({ tipo: 'MP Rotator', boquilla: 'MP2000', arco: 180 }, 300), /MP2000/);
  assert.throws(() => O.ponerArco({ tipo: 'Turbina PGP Ultra con boquilla MPR', boquilla: 'MPR-30', arco: 90 }, 45), /MPR-30 viene solo/);
  assert.throws(() => O.ponerArco(aj, 0), /1° a 360°/);
});

test('ramal dibujado: orden por el caño, tramos, mangueras hasta el caño, codos y metros de caño', () => {
  const { o } = obraDePrueba();
  const asp = (x, y) => ({ tipo: 'Boquilla Pro ajustable', boquilla: '12A-HE', arco: 180, regulador: 'PRS30', distancia: 1, altura: 0, manguera: 1, x, y, giro: 0 });
  const a9 = asp(9, 6), a3 = asp(3, 1), a6 = asp(6, -2), a2 = asp(2.2, 0.1);
  // Caño en L: de la válvula (0,0) hasta (10,0) y de ahí hasta (10,10): un codo
  o.sectores = [{ ...A.sectorNuevo(1), ramal: [{ x: 10, y: 0 }, { x: 10, y: 10 }], aspersores: [a9, a3, a6, a2] }];
  o.plano.distanciasDesdePlano = false;
  o.plano.fuente = { x: -0.5, y: 0 };   // la válvula queda a la salida de la bomba, en (0; 0)
  O.sincronizarDistancias(o);
  const s = o.sectores[0];
  assert.deepEqual(s.aspersores, [a2, a3, a6, a9], 'en el orden en que los pasa el caño');
  assert.deepEqual(s.aspersores.map(a => a.distancia), [2.2, 0.8, 3, 10]);
  assert.deepEqual(s.aspersores.map(a => a.manguera), [0.5, 1, 2, 1], 'pegado al caño: la manguera mínima');
  assert.equal(O.largoRamal(s), 20);
  assert.equal(O.codosRamal(s), 1);
  const pre = O.presupuesto(o, {});
  const renglon = clave => pre.renglones.find(r => r.clave === clave);
  assert.equal(renglon('codo-pvc-k6-32').cantidad, 1);
  assert.equal(renglon('conector-inicial-pe-12').cantidad, 4);
  assert.equal(renglon('manguera-pe-12').cantidad, Math.ceil(4.5 * 1.1));
  assert.equal(renglon('cano-pvc-k6-32').cantidad, Math.ceil(20 * 1.1), 'el largo dibujado del ramal');
  // Sin ramal, el sector sigue como antes
  delete s.ramal;
  s.aspersores.forEach(a => { a.distancia = 4; a.manguera = 1; });
  O.sincronizarDistancias(o);
  assert.deepEqual(s.aspersores.map(a => a.distancia), [4, 4, 4, 4]);
});

test('zonas: la mano de obra usa los m² dibujados; los aspersores sin ubicar no se dibujan ni rompen el ramal', () => {
  const { o, datos } = obraDePrueba();
  o.plano.zonas = [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }], [{ x: 12, y: 0 }, { x: 16, y: 0 }, { x: 14, y: 4 }]];
  assert.equal(O.superficieZonas(o), 60 + 8);
  const pre = O.presupuesto(o, {});
  assert.equal(pre.renglones.find(r => r.clave === 'mo-m2').cantidad, 68);
  // Un sector nuevo arranca vacío y no da error en el presupuesto
  assert.equal(A.sectorNuevo(3).aspersores.length, 0);
  o.sectores.push(A.sectorNuevo(3));
  assert.ok(!O.presupuesto(o, {}).notas.some(n => /error/.test(n)));
  // Con ramal: el que no está ubicado queda al final y no se dibuja
  const s = o.sectores[0];
  s.valvulaPos = { x: 0, y: 0 };
  s.ramal = [{ x: 10, y: 0 }];
  s.aspersores.forEach((a, i) => { a.x = 8 - i * 3; a.y = 1; });
  delete s.aspersores[0].x;
  O.sincronizarDistancias(o);
  assert.equal(s.aspersores.at(-1).x, undefined, 'el sin ubicar queda último');
  assert.ok(O.aspersoresDelPlano(o).filter(a => a.s === 0).every(a => a.x != null));
  assert.equal(O.aspersoresDelPlano(o).filter(a => a.s === 0).length, s.aspersores.length - 1);
});

test('caño escalonado y colector: diámetros que bajan, reducciones, codo del diámetro que corresponde, T y codo a la salida de la bomba', () => {
  const { o } = obraDePrueba();
  o.fuente = { tipo: 'presion', bar: 4 };
  o.plano.fuente = { x: -0.5, y: 0 };
  o.plano.distanciasDesdePlano = false;
  // Tirón en L de 54 m: 50 m derecho y 4 de vuelta; 12 turbinas PGP 3.0 cada 4 m, a 1 m del caño
  const pgp = x => ({ tipo: 'Turbina PGP Ultra', boquilla: '3.0', arco: 180, regulador: '', distancia: 4, altura: 0, manguera: 1, x, y: 1, giro: 0 });
  const largo = { ...A.sectorNuevo(1), ramal: [{ x: 50, y: 0 }, { x: 50, y: 4 }], aspersores: Array.from({ length: 12 }, (_, i) => pgp(6 + i * 4)) };
  o.sectores = [largo];
  O.sincronizarDistancias(o);
  const c = O.calcular(o, largo);
  const diam = c.r.tramos.map(t => t.nominal);
  assert.ok(diam.every((d, i) => !i || d <= diam[i - 1]), `nunca crece hacia el final: ${diam}`);
  assert.ok(new Set(diam).size >= 2, `se escalona: ${diam}`);
  assert.ok(c.r.tramos.every(t => t.velocidad <= R.VELOCIDAD_MAX + 1e-9));
  assert.ok(c.r.variacion <= R.VARIACION_MAX);
  const grupos = R.tramosPorDiametro(c.r.tramos);
  const pre = O.presupuesto(o, {});
  const q = clave => pre.renglones.find(r => r.clave === clave)?.cantidad ?? 0;
  // Una reducción en cada cambio de diámetro; el codo de la vuelta (a los 50 m) y el tapón, del último diámetro
  for (let k = 1; k < grupos.length; k++) assert.equal(q(`reduccion-pvc-k6-${grupos[k - 1].nominal}-${grupos[k].nominal}`), 1);
  assert.equal(q(`codo-pvc-k6-${diam.at(-1)}`), 1);
  assert.equal(q(`tapon-pvc-k6-${diam.at(-1)}`), 1);
  // Metros de caño: todo el ramal dibujado (54 m), repartido por diámetro (+10 %)
  // El último aspersor (50; 1) se engancha en la vuelta, a 51 m por el caño; después siguen 3 m hasta el tapón
  assert.equal(grupos.reduce((t, g) => t + g.largo, 0), 51);
  const ultimo = grupos.at(-1).nominal;
  const metrosUltimo = grupos.filter(g => g.nominal === ultimo).reduce((t, g) => t + g.largo, 0) + 3;
  assert.equal(q(`cano-pvc-k6-${ultimo}`), Math.ceil(metrosUltimo * 1.1));
  // Con un solo sector no hay colector; con tres, 2 T y 1 codo del caño de la salida de la bomba
  assert.equal(q('te-pvc-k6-40'), 0);
  o.sectores.push({ ...A.sectorNuevo(2), aspersores: [pgp(10)] }, { ...A.sectorNuevo(3), aspersores: [pgp(20)] });
  O.sincronizarDistancias(o);
  const pre3 = O.presupuesto(o, {});
  const q3 = clave => pre3.renglones.find(r => r.clave === clave)?.cantidad ?? 0;
  assert.equal(q3('te-pvc-k6-40'), 2);
  assert.equal(q3('codo-pvc-k6-40'), 1);
  assert.equal(q3('valvula-pgv-1'), 3);
  assert.deepEqual(o.sectores.map(s => s.valvulaPos), [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }], 'las válvulas, juntas a la salida de la bomba');
});

test('mantenimiento y caja: horas × precio + materiales, cobros, gastos, ganancia y totales por mes', () => {
  const datos = { siguienteNumero: 30, precios: {} };
  const o = A.obraNueva(datos, 'mantenimiento');
  assert.equal(o.tipo, 'mantenimiento');
  assert.equal(o.sectores.length, 0);
  o.horas = 3;
  o.trabajo = 'Reparación de conexión de la bomba';
  o.presupuesto.propios.push({ id: 'm1', rubro: 'Materiales', descripcion: 'Conector y 2 m de manguera', unidad: 'u', cantidad: 1, precio: 8500 });
  const precios = { 'mo-hora': 12000 };
  const pre = O.presupuesto(o, precios);
  assert.deepEqual(pre.renglones.map(r => [r.clave ?? r.descripcion, r.cantidad, r.importe]), [['mo-hora', 3, 36000], ['Conector y 2 m de manguera', 1, 8500]]);
  assert.equal(pre.total, 44500);
  assert.equal(pre.datos.tipo, 'mantenimiento');
  // Cobros y gastos
  o.cobros.push({ fecha: '2026-10-31', importe: 20000, forma: 'Efectivo' }, { fecha: '2026-11-02', importe: 24500, forma: 'Transferencia' });
  o.gastos.push({ fecha: '2026-10-31', detalle: 'Conector y manguera', importe: 5200 }, { fecha: '2026-10-31', detalle: 'Combustible', importe: 3000 });
  const c = O.cajaDeObra(o, precios);
  assert.deepEqual([c.total, c.cobrado, c.falta, c.gastado, c.ganancia], [44500, 44500, 0, 8200, 36300]);
  assert.ok(Math.abs(c.margen - 36300 / 44500 * 100) < 1e-9);
  // Por mes, con otra obra de riego que tuvo un gasto en noviembre
  const otra = A.obraNueva(datos);
  otra.gastos.push({ fecha: '2026-11-05', detalle: 'Caños', importe: 10000 });
  const meses = O.cajaPorMes([o, otra]);
  assert.deepEqual(meses.map(m => [m.mes, m.cobrado, m.gastado, m.ganancia, m.acumulado]),
    [['2026-10', 20000, 8200, 11800, 11800], ['2026-11', 24500, 10000, 14500, 26300]]);
  // Una obra de riego vieja (sin tipo ni caja) se completa sin problemas
  const vieja = A.importar(JSON.stringify({ app: 'Aspersia', version: 3, instalador: {}, precios: {}, siguienteNumero: 1, obras: [{ ...otra, tipo: undefined, cobros: undefined, gastos: undefined }] }));
  assert.equal(vieja.obras[0].tipo, 'riego');
  assert.deepEqual([vieja.obras[0].cobros, vieja.obras[0].gastos], [[], []]);
});
