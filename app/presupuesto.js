// Materiales y presupuesto de una obra.
// Lee el diseño (sectores y aspersores) y arma los renglones solos: cuerpos, boquillas, turbinas, válvulas,
// caños, bomba, programador y mano de obra por m². Los precios salen de la lista de precios del instalador;
// cada renglón se puede corregir en la obra (cantidad, descripción, quitarlo) y se pueden agregar renglones propios.
// Funciona en el navegador y en Node (las pruebas lo cargan con globalThis). Usa window.RIEGO (app/calculo.js).

(function (global) {
  const RUBROS = ['Materiales', 'Mano de obra', 'Otros'];
  const IVA = 21;

  // ---------- Superficie regada ----------

  // Estimación de la superficie que riega un sector, para la mano de obra por m².
  // Con buena cobertura (aspersores a la distancia de su alcance), cada aspersor riega más o menos
  // su alcance al cuadrado, en proporción a su arco. Las franjas riegan ancho × largo.
  function superficieEstimada(resultado, aspersores) {
    let m2 = 0;
    resultado.aspersores.forEach((a, i) => {
      const e = a.emisor;
      if (e.tipo === 'MP Rotator de franja') {
        m2 += 1.5 * a.radio;              // las tres franjas MP tiran 1,5 m de ancho (pág. 54)
      } else {
        const arco = e.arco ?? aspersores[i].arco ?? 360;
        m2 += a.radio * a.radio * arco / 360;
      }
    });
    return m2;
  }

  // ---------- Materiales que salen del diseño ----------

  const rangoMP = (modelo, arco) => {
    if (modelo === 'MP3500') return '90° a 210°';
    if (arco === 360) return '360°';
    return arco > 210 ? '210° a 270°' : '90° a 210°';
  };

  // Devuelve el renglón de la boquilla (o turbina) de un aspersor ya calculado.
  function renglonesAspersor(e, regulador) {
    const r = [];
    if (e.cuerpo === 'Pro-Spray') {
      if (regulador === 'PRS30') r.push(['cuerpo-prs30', 'Cuerpo difusor Hunter Pro-Spray PRS30 de 10 cm (regula a 2,1 bar)', 'u']);
      else if (regulador === 'PRS40') r.push(['cuerpo-prs40', 'Cuerpo difusor Hunter Pro-Spray PRS40 de 10 cm (regula a 2,8 bar)', 'u']);
      else r.push(['cuerpo-pros', 'Cuerpo difusor Hunter Pro-Spray de 10 cm', 'u']);
    }
    switch (e.tipo) {
      case 'Boquilla Pro fija':
        r.push([`boq-pro-${e.boquilla}-${e.arco}`, `Boquilla Hunter Pro ${e.boquilla} de ${e.arco}°`, 'u']); break;
      case 'Boquilla Pro ajustable':
        r.push([`boq-proaj-${e.boquilla}`, `Boquilla Hunter ajustable ${e.boquilla}`, 'u']); break;
      case 'MP Rotator':
        r.push([`boq-mp-${e.boquilla}-${rangoMP(e.boquilla, e.arco)}`, `Boquilla Hunter ${e.boquilla} MP Rotator (${rangoMP(e.boquilla, e.arco)})`, 'u']); break;
      case 'MP Rotator de franja':
        r.push([`boq-mp-${e.boquilla}`, `Boquilla Hunter ${e.boquilla} MP Rotator de franja`, 'u']); break;
      case 'Turbina PGP Ultra':
        r.push(['turbina-pgp-ultra', 'Turbina Hunter PGP Ultra de 10 cm (trae juego de boquillas)', 'u']); break;
      case 'Turbina PGP Ultra con boquilla MPR':
        r.push(['turbina-pgp-ultra', 'Turbina Hunter PGP Ultra de 10 cm (trae juego de boquillas)', 'u']);
        r.push([`boq-${e.boquilla}-${e.arco}`, `Boquilla Hunter ${e.boquilla} de ${e.arco}° para turbina`, 'u']); break;
    }
    return r;
  }

  // obra: { fuente, accesorios, sectores: [...], presupuesto: { desperdicio } }
  // sectorParaCalcular(sector) arma lo que pide RIEGO.calcularSector (lo da la pantalla).
  function materialesDeObra(obra, sectorParaCalcular) {
    // Mantenimiento o reparación: horas de trabajo (al precio de la hora de la lista); los materiales se escriben
    // como renglones propios (detalle e importe).
    if (obra.tipo === 'mantenimiento')
      return { renglones: [{ clave: 'mo-hora', rubro: 'Mano de obra', descripcion: 'Horas de trabajo', unidad: 'h', cantidad: obra.horas ?? 1, auto: true }],
        aspersores: 0, valvulas: 0, metrosZanja: 0, m2: 0, m2Estimados: false, notas: [] };
    const R = global.RIEGO;
    const suma = new Map();   // clave → renglón
    const sumar = (clave, rubro, descripcion, unidad, cantidad) => {
      if (!cantidad) return;
      const r = suma.get(clave) || { clave, rubro, descripcion, unidad, cantidad: 0, auto: true };
      r.cantidad += cantidad;
      suma.set(clave, r);
    };
    const desperdicio = 1 + (obra.presupuesto?.desperdicio ?? 10) / 100;
    const canos = new Map();      // material-nominal → { lateral, alimentacion }
    const mangueras = new Map();  // tipo de manguera → { mang, metros }
    let valvulas = 0, aspersores = 0, m2 = 0, m2Estimados = false, usaPVC = false, salidas = 0, colector = null;
    const notas = [];

    obra.sectores.forEach((s, i) => {
      if (!s.aspersores.length) return;   // sector todavía sin aspersores: no lleva materiales
      let r = null;
      try { r = R.calcularSector(sectorParaCalcular(s)); } catch { notas.push(`El ${s.nombre || 'sector ' + (i + 1)} tiene un error y no se contó.`); return; }
      const mang = s.manguera && R.MANGUERAS[s.manguera];
      r.aspersores.forEach((a, j) => {
        aspersores++;
        for (const [clave, desc, u] of renglonesAspersor(a.emisor, a.regulador)) sumar(clave, 'Materiales', desc, u, 1);
        // Conexión al caño, como instala Darío: conector inicial + manguera + espiga en L con la rosca del cuerpo
        // (½" los Pro-Spray, pág. 67; ¾" las PGP Ultra, pág. 22). Sin manguera, va directo al caño.
        if (mang && a.manguera > 0) {
          const rosca = a.emisor.cuerpo === 'PGP Ultra' ? '¾"' : '½"';
          sumar(`conector-inicial-${s.manguera}`, 'Materiales', `Conector inicial para manguera de ${mang.corto}`, 'u', 1);
          sumar(`espiga-l-${s.manguera}-${rosca}`, 'Materiales', `Espiga en L a 90° para manguera de ${mang.corto} con rosca de ${rosca}`, 'u', 1);
          const m = mangueras.get(s.manguera) || { mang, metros: 0 };
          m.metros += a.manguera;
          mangueras.set(s.manguera, m);
        } else sumar('conexion-aspersor', 'Materiales', 'Conexión directa al caño (te o buje y niple)', 'u', 1);
      });
      // Caño del sector: cada tramo con su diámetro (escalonado o uno solo). Con el ramal dibujado en el plano
      // el caño es el largo dibujado (lo que sigue después del último aspersor va con el último diámetro) y lleva
      // un codo en cada quiebre, del diámetro del tramo donde cae. Termina con un tapón; en cada cambio, una reducción.
      const mat = s.lateral.material, tipoLat = R.CANOS[mat], esPVC = /^pvc/.test(mat);
      const pieza = (clave, nombre, nominal, cantidad) => sumar(`${clave}-${mat}-${nominal}`, 'Materiales',
        esPVC ? `${nombre} de PVC de ${nominal} mm` : `${nombre} para caño ${tipoLat.nombre} de ${nominal} mm`, 'u', cantidad);
      const tramos = r.tramos.map(t => ({ nominal: t.nominal ?? s.lateral.nominal, largo: t.largo }));
      const ramal = s.ramal && s.ramal.length && s.valvulaPos ? [s.valvulaPos, ...s.ramal] : null;
      if (ramal) {
        const largoRamal = ramal.slice(1).reduce((t, p, k) => t + Math.hypot(p.x - ramal[k].x, p.y - ramal[k].y), 0);
        const hastaUltimo = tramos.reduce((t, x) => t + x.largo, 0);
        if (largoRamal > hastaUltimo) tramos.push({ nominal: tramos.at(-1).nominal, largo: largoRamal - hastaUltimo });
        // Codos: en cada quiebre, del diámetro del tramo que pasa por ahí
        let recorrido = 0;
        for (let k = 1; k < ramal.length - 1; k++) {
          recorrido += Math.hypot(ramal[k].x - ramal[k - 1].x, ramal[k].y - ramal[k - 1].y);
          let acum = 0, nominal = tramos.at(-1).nominal;
          for (const t of tramos) { acum += t.largo; if (recorrido <= acum + 1e-9) { nominal = t.nominal; break; } }
          pieza('codo', 'Codo', nominal, 1);
        }
      }
      for (const t of tramos) {
        const clave = `${mat}-${t.nominal}`;
        const c = canos.get(clave) || { material: mat, nominal: t.nominal, lateral: 0, alimentacion: 0 };
        c.lateral += t.largo;
        canos.set(clave, c);
      }
      for (let k = 1; k < tramos.length; k++) if (tramos[k].nominal !== tramos[k - 1].nominal)
        sumar(`reduccion-${mat}-${tramos[k - 1].nominal}-${tramos[k].nominal}`, 'Materiales',
          `Reducción ${esPVC ? 'de PVC ' : ''}de ${tramos[k - 1].nominal} a ${tramos[k].nominal} mm`, 'u', 1);
      pieza('tapon', 'Tapón', tramos.at(-1).nominal, 1);
      if (esPVC || /^pvc/.test(s.alimentacion?.material || '')) usaPVC = true;
      if (s.valvula) valvulas++;
      salidas++;
      colector ||= s.alimentacion;
      if (s.alimentacion && s.alimentacion.largo > 0) {
        const al = `${s.alimentacion.material}-${s.alimentacion.nominal}`;
        const ca = canos.get(al) || { material: s.alimentacion.material, nominal: s.alimentacion.nominal, lateral: 0, alimentacion: 0 };
        // Las válvulas suelen ir juntas en una caja: el caño hasta ellas se comparte, se cuenta el más largo.
        ca.alimentacion = Math.max(ca.alimentacion, s.alimentacion.largo);
        canos.set(al, ca);
      }
      if (s.superficie > 0) m2 += s.superficie;
      else { m2 += superficieEstimada(r, s.aspersores); m2Estimados = true; }
    });

    for (const [tipo, m] of mangueras)
      sumar(`manguera-${tipo}`, 'Materiales', `Manguera de ${m.mang.nombre.charAt(0).toLowerCase()}${m.mang.nombre.slice(1)}`, 'm', Math.ceil(m.metros * desperdicio));
    if (usaPVC) sumar('pegamento-pvc', 'Materiales', 'Adhesivo para caños de PVC', 'u', 1);
    // Colector a la salida de la bomba (como lo arma Darío): un caño corto con una T por cada sector menos uno
    // y un codo al final. Con un solo sector, la válvula va directo.
    if (salidas > 1 && colector) {
      const cm = colector.material, pvc = /^pvc/.test(cm), nombre = R.CANOS[cm].nombre;
      sumar(`te-${cm}-${colector.nominal}`, 'Materiales', pvc ? `T de PVC de ${colector.nominal} mm` : `T para caño ${nombre} de ${colector.nominal} mm`, 'u', salidas - 1);
      sumar(`codo-${cm}-${colector.nominal}`, 'Materiales', pvc ? `Codo de PVC de ${colector.nominal} mm` : `Codo para caño ${nombre} de ${colector.nominal} mm`, 'u', 1);
    }
    if (valvulas) {
      sumar('valvula-pgv-1', 'Materiales', 'Electroválvula Hunter PGV-101 de 1"', 'u', valvulas);
      sumar('caja-valvulas', 'Materiales', 'Caja para válvulas con tapa', 'u', 1);
      // Programador residencial Hunter X2 (catálogo 2026): de 4, 6, 8 o 14 estaciones; en 230 V, modelo X2-N01-E.
      const x2 = [4, 6, 8, 14].find(n => n >= valvulas);
      if (x2) sumar(`programador-x2-${x2}`, 'Materiales', `Programador Hunter X2 de ${x2} estaciones (X2-${x2}01-E, 230 V)`, 'u', 1);
      else {
        sumar(`programador-${valvulas}`, 'Materiales', `Programador Hunter comercial de ${valvulas} estaciones (Pro-C o HPC con módulos)`, 'u', 1);
        notas.push('Más de 14 sectores: el X2 no alcanza, va un programador comercial (Pro-C o HPC con módulos de estaciones).');
      }
    }
    let metrosZanja = 0;
    for (const c of canos.values()) {
      const metros = c.lateral + c.alimentacion;
      metrosZanja += metros;
      sumar(`cano-${c.material}-${c.nominal}`, 'Materiales', `Caño ${R.CANOS[c.material].nombre} de ${c.nominal} mm`, 'm', Math.ceil(metros * desperdicio));
    }
    if (obra.fuente.tipo === 'bomba') {
      const b = R.bomba(obra.fuente.linea, obra.fuente.modelo);
      sumar(`bomba-${b.linea}-${b.modelo}`, 'Materiales', `Bomba Czerweny ${b.modelo} (${R.fmt(b.hp, b.hp % 1 ? 2 : 0)} HP, ${b.tension.split(' (')[0]})`, 'u', 1);
    }
    // Con zonas a regar dibujadas en el plano, la superficie es la de esas zonas (fórmula del cordón de zapato).
    const zonas = obra.plano?.zonas || [];
    if (zonas.length) {
      m2 = zonas.reduce((t, z) => t + Math.abs(z.reduce((u, p, k) => { const q = z[(k + 1) % z.length]; return u + p.x * q.y - q.x * p.y; }, 0)) / 2, 0);
      m2Estimados = false;
    }
    sumar('mo-obra', 'Mano de obra', `Mano de obra de instalación del riego${m2 ? ` (unos ${Math.round(m2)} m²)` : ''}`, 'gl', 1);
    if (m2Estimados) notas.push('Hay sectores sin superficie cargada: los m² se estimaron con el alcance de los aspersores.');

    return { renglones: [...suma.values()], aspersores, valvulas, metrosZanja, m2: Math.round(m2), m2Estimados, notas };
  }

  // ---------- Presupuesto ----------

  // p = obra.presupuesto: { cambios: {clave: {cantidad, descripcion, quitar}}, propios: [...], descuento, iva }
  // precios = lista de precios del instalador { clave: precio }
  function armarPresupuesto(obra, precios, sectorParaCalcular) {
    const p = obra.presupuesto || {};
    if (p.congelado) return p.congelado;
    const m = materialesDeObra(obra, sectorParaCalcular);
    const cambios = p.cambios || {};
    const renglones = [];
    for (const r of m.renglones) {
      const c = cambios[r.clave] || {};
      if (c.quitar) continue;
      renglones.push({
        ...r,
        cantidadCalculada: r.cantidad,
        cantidad: c.cantidad ?? r.cantidad,
        descripcion: c.descripcion || r.descripcion,
        precio: precios[r.clave] ?? 0,
      });
    }
    for (const r of p.propios || []) renglones.push({ ...r, auto: false });
    for (const r of renglones) r.importe = redondear((r.cantidad || 0) * (r.precio || 0));
    // Mano de obra de riego (Darío): por defecto el 200 % de los materiales a precio de venta, más o menos un ajuste
    // por el terreno (piedra, etc.); también se puede poner un importe fijo.
    const mo = renglones.find(r => r.clave === 'mo-obra');
    const materiales = renglones.filter(r => r.rubro === 'Materiales').reduce((t, r) => t + r.importe, 0);
    const manoObra = { porcentaje: 200, ajuste: 0, fijo: null, ...(p.manoObra || {}) };
    if (mo) {
      mo.precio = manoObra.fijo != null ? manoObra.fijo : redondear(materiales * manoObra.porcentaje / 100 * (1 + manoObra.ajuste / 100));
      mo.cantidad = 1;
      mo.importe = mo.precio;
    }
    // Utilidad: lo que cuestan los materiales (lista de costos) contra lo que se cobra
    const costos = global.PRESUPUESTO_COSTOS || {};
    const costoMateriales = renglones.filter(r => r.rubro === 'Materiales').reduce((t, r) => t + (r.cantidad || 0) * (r.clave ? (costos[r.clave] || 0) : (r.costo || 0)), 0);
    const sinCosto = renglones.filter(r => r.rubro === 'Materiales' && r.cantidad && r.clave && !costos[r.clave]).length;

    const subtotales = Object.fromEntries(RUBROS.map(rb => [rb, renglones.filter(r => r.rubro === rb).reduce((t, r) => t + r.importe, 0)]));
    const subtotal = Object.values(subtotales).reduce((a, b) => a + b, 0);
    const descuento = redondear(subtotal * (p.descuento || 0) / 100);
    const neto = subtotal - descuento;
    const iva = p.iva ? redondear(neto * IVA / 100) : 0;
    const quitados = m.renglones.filter(r => (cambios[r.clave] || {}).quitar);
    // Opciones (A, B, C…): no se suman. El total es el que se escribe a mano; vacío = "según la opción elegida".
    // Sin opciones, un total escrito a mano reemplaza a la suma.
    const opciones = !!p.opciones, totalManual = typeof p.totalManual === 'number' ? p.totalManual : null;
    const totalCalculado = neto + iva;
    const total = totalManual ?? (opciones ? 0 : totalCalculado);
    // Todo lo que muestra el PDF va acá adentro: al cerrar el presupuesto se guarda tal cual, y el PDF
    // de un presupuesto enviado no cambia aunque después se toque el diseño.
    return {
      renglones, quitados, subtotales, subtotal, descuento, descuentoPct: p.descuento || 0, neto, iva, total, totalCalculado, opciones, totalManual,
      segunOpcion: opciones && totalManual == null,
      sinPrecio: renglones.filter(r => !r.precio && r.cantidad).length,
      manoObra, materiales, costoMateriales: redondear(costoMateriales), sinCosto, utilidad: redondear(neto - costoMateriales),
      datos: {
        aspersores: m.aspersores, valvulas: m.valvulas, metrosZanja: m.metrosZanja, m2: m.m2, m2Estimados: m.m2Estimados,
        sectores: obra.sectores.map(s => ({ nombre: s.nombre, aspersores: s.aspersores.length })),
        tipo: obra.tipo || 'riego', trabajo: obra.trabajo || '',
      },
      notas: m.notas,
    };
  }

  const redondear = v => Math.round(v * 100) / 100;
  const pesos = v => '$ ' + Number(v || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  global.PRESUPUESTO = { RUBROS, IVA, superficieEstimada, materialesDeObra, armarPresupuesto, pesos };
})(typeof window !== 'undefined' ? window : globalThis);
