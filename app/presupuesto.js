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
    let valvulas = 0, aspersores = 0, m2 = 0, m2Estimados = false;
    const notas = [];

    obra.sectores.forEach((s, i) => {
      let r = null;
      try { r = R.calcularSector(sectorParaCalcular(s)); } catch { notas.push(`El ${s.nombre || 'sector ' + (i + 1)} tiene un error y no se contó.`); return; }
      r.aspersores.forEach((a, j) => {
        aspersores++;
        for (const [clave, desc, u] of renglonesAspersor(a.emisor, a.regulador)) sumar(clave, 'Materiales', desc, u, 1);
      });
      if (s.valvula) valvulas++;
      const lat = `${s.lateral.material}-${s.lateral.nominal}`;
      const c = canos.get(lat) || { material: s.lateral.material, nominal: s.lateral.nominal, lateral: 0, alimentacion: 0 };
      c.lateral += s.aspersores.reduce((t, a) => t + (a.distancia || 0), 0);
      canos.set(lat, c);
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

    if (aspersores) sumar('conexion-aspersor', 'Materiales', 'Conexión por aspersor (codo articulado, te y abrazaderas)', 'u', aspersores);
    if (valvulas) {
      sumar('valvula-pgv-1', 'Materiales', 'Electroválvula Hunter PGV-101 de 1"', 'u', valvulas);
      sumar('caja-valvulas', 'Materiales', 'Caja para válvulas con tapa', 'u', 1);
      sumar(`programador-${valvulas}`, 'Materiales', `Programador Hunter de ${valvulas} estacion${valvulas === 1 ? '' : 'es'}`, 'u', 1);
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
    sumar('mo-m2', 'Mano de obra', 'Mano de obra de instalación del riego', 'm²', Math.round(m2));
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

    const subtotales = Object.fromEntries(RUBROS.map(rb => [rb, renglones.filter(r => r.rubro === rb).reduce((t, r) => t + r.importe, 0)]));
    const subtotal = Object.values(subtotales).reduce((a, b) => a + b, 0);
    const descuento = redondear(subtotal * (p.descuento || 0) / 100);
    const neto = subtotal - descuento;
    const iva = p.iva ? redondear(neto * IVA / 100) : 0;
    const quitados = m.renglones.filter(r => (cambios[r.clave] || {}).quitar);
    return {
      renglones, quitados, subtotales, subtotal, descuento, neto, iva, total: neto + iva,
      sinPrecio: renglones.filter(r => !r.precio && r.cantidad).length,
      datos: { aspersores: m.aspersores, valvulas: m.valvulas, metrosZanja: m.metrosZanja, m2: m.m2, m2Estimados: m.m2Estimados },
      notas: m.notas,
    };
  }

  const redondear = v => Math.round(v * 100) / 100;
  const pesos = v => '$ ' + Number(v || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  global.PRESUPUESTO = { RUBROS, IVA, superficieEstimada, materialesDeObra, armarPresupuesto, pesos };
})(typeof window !== 'undefined' ? window : globalThis);
