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

test('arranque: las válvulas se ubican solas, los aspersores no (sin fila automática)', () => {
  const sectores = [
    { aspersores: [{ distancia: 2 }, { distancia: 3.7 }, { x: 9, y: 9, giro: 30, distancia: 3 }] },
    { aspersores: [{ distancia: 5 }] },
  ];
  G.ubicarSinPosicion({ ancho: 20, largo: 15 }, sectores);
  assert.ok(sectores[0].valvulaPos && sectores[1].valvulaPos);
  assert.notDeepEqual(sectores[0].valvulaPos, sectores[1].valvulaPos, 'cada válvula en su lugar');
  assert.equal(sectores[0].aspersores[0].x, undefined, 'el que no se ubicó sigue sin ubicar');
  assert.deepEqual([sectores[0].aspersores[2].x, sectores[0].aspersores[2].y, sectores[0].aspersores[2].giro], [9, 9, 30]);
  assert.equal(G.sinUbicar(sectores[0]).length, 2);
  assert.deepEqual(G.distanciasDesdePlano({ x: 0, y: 9 }, sectores[0].aspersores), [null, null, 9]);
});

test('zonas a regar: superficie, adentro/afuera, lado más cercano y cobertura solo adentro', () => {
  // Trapecio torcido como la tierra de la captura de Darío, y una L (con entrante)
  const trapecio = [{ x: 2, y: 1 }, { x: 8, y: 1 }, { x: 10, y: 9 }, { x: 1, y: 8 }];
  const ele = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 6 }, { x: 0, y: 6 }];
  assert.equal(G.areaPoligono(ele), 6 * 2 + 2 * 4);
  assert.equal(G.areaPoligono([...trapecio].reverse()), G.areaPoligono(trapecio), 'no importa el sentido en que se marcó');
  assert.ok(G.dentroDePoligono(ele, 1, 5) && G.dentroDePoligono(ele, 5, 1) && !G.dentroDePoligono(ele, 4, 4), 'el entrante de la L queda afuera');
  const lado = G.ladoMasCercano([trapecio], { x: 5, y: 0.6 });
  assert.deepEqual([lado.zona, lado.lado, lado.largo], [0, 0, 6]);
  // Un aspersor en el medio: la cobertura cuenta solo lo de adentro de la zona
  const t = { ancho: 12, largo: 10 };
  const cuadrado = [{ x: 4, y: 3 }, { x: 8, y: 3 }, { x: 8, y: 7 }, { x: 4, y: 7 }];
  const c = G.cobertura(t, [{ x: 6, y: 5, radio: 3, arco: 360, giro: 0 }], 0.25, [cuadrado]);
  assert.equal(c.seco, 0, 'el círculo de 3 m cubre todo el cuadrado de 4 × 4');
  assert.ok(c.cuenta.includes(G.FUERA));
  const sinZona = G.cobertura(t, [{ x: 6, y: 5, radio: 3, arco: 360, giro: 0 }], 0.25);
  assert.ok(sinZona.seco > 50, 'sin zona cuenta todo el terreno');
  // Escalar mueve también las zonas
  const plano = { ancho: 12, largo: 10, fuente: { x: 0, y: 0 }, zonas: [cuadrado.map(p => ({ ...p }))] };
  G.escalarPlano(plano, [], 2);
  assert.deepEqual(plano.zonas[0][2], { x: 16, y: 14 });
});

test('sugerir cobertura: un aspersor de esquina mal girado → sugiere girarlo de vuelta hacia el centro', () => {
  const t = { ancho: 8, largo: 8 };
  const esq = (x, y, giro) => ({ x, y, giro, arco: 90, radio: 8.5 });
  const bien = [esq(0, 0, 45), esq(8, 0, 315), esq(8, 8, 225), esq(0, 8, 135)];
  assert.equal(G.sugerirCobertura(t, bien, null).pasos.length, 0, 'bien regado: nada que sugerir');
  const mal = [esq(0, 0, 75), ...bien.slice(1)];
  const r = G.sugerirCobertura(t, mal, null, mal.map(() => ({ arco: null })));
  assert.ok(r.antes.uno > 0);
  const s = r.pasos[0];
  assert.equal(s.k, 0);
  assert.equal(s.tipo, 'girar');
  assert.equal(s.valor, -30);
});

test('alinear con el borde: en un lado 180° hacia adentro; en una esquina torcida abre lo que mide la esquina', () => {
  // Zona torcida: el lado de abajo sube un poco (no es parejo)
  const z = [{ x: 0, y: 0 }, { x: 10, y: 1 }, { x: 10, y: 8 }, { x: 0, y: 8 }];
  const lado = G.alinearConBorde([z], { x: 5, y: 0.5 });
  assert.equal(lado.tipo, 'lado');
  assert.equal(lado.arco, 180);
  assert.equal(lado.giro, Math.round((G.rumbo(10, 1) + 270) % 360));   // perpendicular al lado, hacia adentro (arriba)
  const esq = G.alinearConBorde([z], { x: 0.2, y: 0.2 });
  assert.equal(esq.tipo, 'esquina');
  assert.equal(esq.arco, 84);   // la esquina mide 84,3°: el abanico calza justo con los dos lados
  assert.equal(G.alinearConBorde([[{ x: 0, y: 0 }, { x: 10, y: 0.4 }, { x: 10, y: 8 }, { x: 0, y: 8 }]], { x: 0.2, y: 0.2 }).arco, 90, 'a 2° de 90 se redondea (sirve la fija)');
  const esq2 = G.alinearConBorde([z], { x: 10, y: 1 });
  assert.equal(esq2.arco, Math.round(180 - 84.29));   // 96° (a más de 4° de 90: se deja exacto)
});

test('sugerir cobertura: nunca moja afuera de la zona y sugiere cambiar la boquilla', () => {
  // Cantero de 7 × 4 m; dos aspersores de 90° en las esquinas de abajo, regando hacia adentro, con un hueco en el medio
  const t = { ancho: 7, largo: 4 }, zona = [[{ x: 0, y: 0 }, { x: 7, y: 0 }, { x: 7, y: 4 }, { x: 0, y: 4 }]];
  const lista = [{ x: 0, y: 0, giro: 45, arco: 90, radio: 3, boquilla: '10' }, { x: 7, y: 0, giro: 315, arco: 90, radio: 3, boquilla: '10' }];
  // Boquillas posibles: la 15 (alcance 4,6 m) se pasa del borde de arriba; la 12 (3,7 m) no
  const op = lista.map(() => ({ arco: [25, 360], boquillas: [{ boquilla: '12', radio: 3.7 }, { boquilla: '15', radio: 4.6 }] }));
  const r = G.sugerirCobertura(t, lista, zona, op);
  assert.ok(r.pasos.length >= 1);
  assert.ok(r.pasos.every(p => !(p.tipo === 'arco' && p.valor > 90)), 'abrir el arco de la esquina mojaría la vereda');
  assert.ok(r.pasos.every(p => !(p.tipo === 'boquilla' && p.valor === '15')), 'la 15 se pasa del borde de arriba');
  assert.ok(r.pasos.some(p => p.tipo === 'boquilla' && p.valor === '12'), 'la 12 cubre más sin salirse');
  assert.ok(r.despues.bien > r.antes.bien);
  assert.ok(r.pasos[0].celdas.length > 0, 'trae la parte que mejora, para pintarla');
});

test('la manguera no cruza el límite del lote: va al punto del caño al que se llega por adentro', () => {
  // Dos lotes separados por un muro (franja entre y = 5 y y = 5,2). El caño va por abajo y sube por la derecha.
  const lotes = [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }], [{ x: 0, y: 5.2 }, { x: 10, y: 5.2 }, { x: 10, y: 10 }, { x: 0, y: 10 }]];
  const valvula = { x: 1, y: 1 }, ramal = [{ x: 9, y: 1 }, { x: 9, y: 9 }], asp = { x: 2, y: 7 };
  // Sin límites: lo más cercano es el tramo de abajo (6 m), cruzando el muro
  const recto = G.conexionesAlRamal(valvula, ramal, [asp])[0];
  assert.ok(Math.abs(recto.punto.y - 1) < 1e-6 && Math.abs(recto.punto.x - 2) < 1e-6);
  assert.ok(G.cruzaBorde(lotes, asp, recto.punto));
  // Con los límites: va al tramo que sube, por adentro de su lote (7 m), sin cruzar
  const c = G.conexionesAlRamal(valvula, ramal, [asp], lotes)[0];
  assert.ok(!G.cruzaBorde(lotes, asp, c.punto), 'la manguera queda adentro del lote');
  assert.ok(c.punto.x > 8.9 && c.punto.y > 5.2, "se conecta en el tramo de la derecha");
  assert.ok(Math.abs(c.manguera - 7) < 0.15);
});
