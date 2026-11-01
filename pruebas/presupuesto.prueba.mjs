// Pruebas de materiales y presupuesto. Correr con:  node --test pruebas/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis;
for (const f of ['datos/hunter-2026.js', 'datos/czerweny.js', 'app/calculo.js', 'app/presupuesto.js'])
  vm.runInThisContext(fs.readFileSync(path.join(raiz, f), 'utf8'), { filename: f });
const R = globalThis.RIEGO, P = globalThis.PRESUPUESTO;

// La pantalla guarda los aspersores con tipo/boquilla/arco; para calcular se pasa el id del aspersor.
const id = a => a.emisor;
const paraCalcular = obra => s => ({
  fuente: obra.fuente, alimentacion: s.alimentacion, valvula: s.valvula, lateral: s.lateral, accesorios: 10,
  aspersores: s.aspersores.map(a => ({ emisor: id(a), regulador: a.regulador || null, distancia: a.distancia, altura: 0 })),
});
const obraEjemplo = () => ({
  fuente: { tipo: 'presion', bar: 3.5 },
  presupuesto: { desperdicio: 10 },
  sectores: [
    { nombre: 'Frente', valvula: true, superficie: 0,
      alimentacion: { material: 'pead-pn6', nominal: 32, largo: 12, desnivel: 0 }, lateral: { material: 'pead-pn6', nominal: 25 },
      aspersores: [
        { emisor: 'pro-12-180', regulador: 'PRS30', distancia: 2 },
        { emisor: 'pro-12-180', regulador: 'PRS30', distancia: 3.7 },
        { emisor: 'pro-12-90', regulador: 'PRS30', distancia: 3.7 },
        { emisor: 'pro-15A-HE@120', regulador: null, distancia: 4 },
      ] },
    { nombre: 'Fondo', valvula: true, superficie: 150,
      alimentacion: { material: 'pead-pn6', nominal: 32, largo: 20, desnivel: 0 }, lateral: { material: 'pead-pn6', nominal: 32 },
      aspersores: [
        { emisor: 'pgp-3.0', distancia: 5, arco: 180 },
        { emisor: 'pgp-MPR-30-90', distancia: 10 },
      ] },
  ],
});
const porClave = (renglones, clave) => renglones.find(r => r.clave === clave);

test('materiales: cuenta cuerpos, boquillas, turbinas, válvulas, caños y programador', () => {
  const obra = obraEjemplo();
  const m = P.materialesDeObra(obra, paraCalcular(obra));
  const q = clave => porClave(m.renglones, clave)?.cantidad;
  assert.equal(q('cuerpo-prs30'), 3);
  assert.equal(q('cuerpo-pros'), 1);
  assert.equal(q('boq-pro-12-180'), 2);
  assert.equal(q('boq-pro-12-90'), 1);
  assert.equal(q('boq-proaj-15A-HE'), 1, 'la ajustable es una sola boquilla, sin importar el arco');
  assert.equal(q('turbina-pgp-ultra'), 2, 'la turbina con MPR también lleva su cuerpo PGP Ultra');
  assert.equal(q('boq-MPR-30-90'), 1);
  assert.equal(q('valvula-pgv-1'), 2);
  assert.equal(q('caja-valvulas'), 1);
  assert.equal(q('programador-x2-4'), 1);
  assert.equal(q('conexion-aspersor'), 6);
  // Caño 25: lateral del Frente 2 + 3,7 + 3,7 + 4 = 13,4 m + 10 % = 14,74 → 15 m
  assert.equal(q('cano-pead-pn6-25'), 15);
  // Caño 32: lateral del Fondo 15 m + alimentación compartida (la más larga, 20 m) = 35 m + 10 % = 38,5 → 39 m
  assert.equal(q('cano-pead-pn6-32'), 39);
  assert.equal(m.metrosZanja, 13.4 + 35);
});

test('mano de obra por m²: usa la superficie cargada y estima la que falta', () => {
  const obra = obraEjemplo();
  const m = P.materialesDeObra(obra, paraCalcular(obra));
  const r = R.calcularSector(paraCalcular(obra)(obra.sectores[0]));
  const estimado = P.superficieEstimada(r, obra.sectores[0].aspersores);
  // Frente estimado + Fondo cargado (150 m²)
  assert.equal(m.m2, Math.round(estimado + 150));
  assert.equal(m.m2Estimados, true);
  assert.equal(porClave(m.renglones, 'mo-obra').cantidad, 1);
  assert.match(porClave(m.renglones, 'mo-obra').descripcion, new RegExp(`unos ${m.m2} m²`));
  // Estimación: una boquilla 12 a 180° con 2,1 bar en la boquilla alcanza 3,7 m → 3,7² × 180/360
  const unaSola = { aspersores: [{ emisor: R.emisor('pro-12-180'), radio: 3.7 }] };
  assert.ok(Math.abs(P.superficieEstimada(unaSola, [{}]) - 3.7 * 3.7 / 2) < 1e-9);
});

test('presupuesto: precios de la lista, cambios de la obra, renglones propios, descuento e IVA', () => {
  const obra = obraEjemplo();
  obra.sectores[0].superficie = 50;
  const precios = { 'cuerpo-prs30': 10000, 'boq-pro-12-180': 3000, 'cano-pead-pn6-25': 1500 };
  obra.presupuesto = {
    desperdicio: 10,
    cambios: { 'cano-pead-pn6-25': { cantidad: 20 }, 'caja-valvulas': { quitar: true }, 'boq-pro-12-180': { descripcion: 'Boquilla 12H' } },
    propios: [{ id: 'x1', rubro: 'Otros', descripcion: 'Rotura y arreglo de vereda', unidad: 'gl', cantidad: 1, precio: 45000 }],
    descuento: 10, iva: true,
  };
  const p = P.armarPresupuesto(obra, precios, paraCalcular(obra));
  assert.equal(porClave(p.renglones, 'cuerpo-prs30').importe, 30000);
  assert.equal(porClave(p.renglones, 'cano-pead-pn6-25').importe, 30000, 'usa la cantidad cambiada (20 m)');
  assert.equal(porClave(p.renglones, 'cano-pead-pn6-25').cantidadCalculada, 15);
  assert.equal(porClave(p.renglones, 'caja-valvulas'), undefined, 'el renglón quitado no aparece');
  assert.equal(p.quitados.length, 1);
  assert.equal(porClave(p.renglones, 'boq-pro-12-180').descripcion, 'Boquilla 12H');
  const materiales = 30000 + 6000 + 30000;
  assert.equal(p.subtotales['Materiales'], materiales);
  // Mano de obra: por defecto el 200 % de los materiales a precio de venta (Darío)
  assert.equal(porClave(p.renglones, 'mo-obra').importe, materiales * 2);
  assert.equal(p.subtotales['Mano de obra'], materiales * 2);
  assert.equal(p.subtotales['Otros'], 45000);
  assert.equal(p.subtotal, materiales * 3 + 45000);
  // Terreno con piedra: +30 %; o un importe fijo
  obra.presupuesto.manoObra = { porcentaje: 200, ajuste: 30 };
  assert.equal(porClave(P.armarPresupuesto(obra, precios, paraCalcular(obra)).renglones, 'mo-obra').importe, materiales * 2 * 1.3);
  obra.presupuesto.manoObra = { fijo: 100000 };
  assert.equal(porClave(P.armarPresupuesto(obra, precios, paraCalcular(obra)).renglones, 'mo-obra').importe, 100000);
  assert.equal(p.descuento, p.subtotal * 0.1);
  assert.equal(p.iva, Math.round((p.subtotal - p.descuento) * 0.21 * 100) / 100);
  assert.equal(p.total, p.subtotal - p.descuento + p.iva);
  assert.ok(p.sinPrecio > 0, 'avisa los renglones que no tienen precio');
});

test('presupuesto congelado: no cambia aunque cambien el diseño o los precios', () => {
  const obra = obraEjemplo();
  const precios = { 'cuerpo-prs30': 2000 };
  const antes = P.armarPresupuesto(obra, precios, paraCalcular(obra));
  obra.presupuesto.congelado = antes;
  obra.sectores[0].aspersores.push({ emisor: 'pro-12-180', regulador: 'PRS30', distancia: 3 });
  precios['cuerpo-prs30'] = 9999;
  assert.equal(P.armarPresupuesto(obra, precios, paraCalcular(obra)).total, antes.total);
});

test('bomba: entra como material con su potencia', () => {
  const obra = obraEjemplo();
  obra.fuente = { tipo: 'bomba', linea: 'ZETA', modelo: 'ZETA 2', aspiracion: 0 };
  const m = P.materialesDeObra(obra, paraCalcular(obra));
  assert.match(porClave(m.renglones, 'bomba-ZETA-ZETA 2').descripcion, /ZETA 2 \(1 HP/);
});

test('formato en pesos', () => {
  assert.equal(P.pesos(1234567), '$ 1.234.567');
  assert.equal(P.pesos(1500.5), '$ 1.500,5');
});
