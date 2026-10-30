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
    { ...A.sectorNuevo(2), nombre: 'Fondo', superficie: 160, lateral: { material: 'pead-pn6', nominal: 32 }, aspersores: [
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
  o.plano = { ancho: 20, largo: 12, fuente: { x: 0, y: 0 }, distanciasDesdePlano: true, verCobertura: true };
  o.sectores[0].valvulaPos = { x: 0, y: 3 };
  [[3, 4], [3, 10], [9, 10]].forEach(([x, y], i) => Object.assign(o.sectores[0].aspersores[i], { x, y, giro: 90 }));
  o.sectores[1].valvulaPos = { x: 1, y: 0 };
  [[4, 4], [10, 4]].forEach(([x, y], i) => Object.assign(o.sectores[1].aspersores[i], { x, y, giro: 0 }));
  O.sincronizarDistancias(o);
  // Frente: válvula (0;3) → (3;4) = √10 ≈ 3,2 m; → (3;10) = 6 m; → (9;10) = 6 m. Fondo: (1;0) → (4;4) = 5 m; → (10;4) = 6 m.
  assert.deepEqual(o.sectores[0].aspersores.map(a => a.distancia), [3.2, 6, 6]);
  assert.deepEqual(o.sectores[1].aspersores.map(a => a.distancia), [5, 6]);
  assert.equal(o.sectores[0].alimentacion.largo, 3);
  assert.equal(o.sectores[1].alimentacion.largo, 1);
  // El cálculo usa esos tramos
  const c = O.calcular(o, o.sectores[0]);
  assert.deepEqual(c.r.tramos.map(t => t.largo), [3.2, 6, 6]);
  // El presupuesto cuenta esos metros, cada material y diámetro por separado (+10 % de desperdicio)
  const m = P.materialesDeObra(o, O.paraCalcular(o));
  const q = clave => m.renglones.find(r => r.clave === clave).cantidad;
  assert.equal(q('cano-pvc-k6-32'), Math.ceil(15.2 * 1.1));     // ramal del Frente (PVC K6 32)
  assert.equal(q('cano-pead-pn6-32'), Math.ceil(11 * 1.1));     // ramal del Fondo (PEAD 32)
  assert.equal(q('cano-pvc-k6-40'), Math.ceil(3 * 1.1));        // alimentación compartida: la más larga (3 m)
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
  assert.equal(vuelta.siguienteNumero, 13);
  assert.throws(() => A.importar('{"hola":1}'), /no es una copia de seguridad/);
});
