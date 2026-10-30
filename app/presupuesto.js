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
    const mangueras = new Map();  // tipo de manguera → { mang, metros }
    let valvulas = 0, aspersores = 0, m2 = 0, m2Estimados = false, usaPVC = false;
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
      // El ramal del sector termina con un tapón.
      const tipoLat = R.CANOS[s.lateral.material];
      sumar(`tapon-${s.lateral.material}-${s.lateral.nominal}`, 'Materiales',
        /^pvc/.test(s.lateral.material) ? `Tapón de PVC de ${s.lateral.nominal} mm` : `Tapón final de caño ${tipoLat.nombre} de ${s.lateral.nominal} mm`, 'u', 1);
      if (/^pvc/.test(s.lateral.material) || /^pvc/.test(s.alimentacion?.material || '')) usaPVC = true;
      if (s.valvula) valvulas++;
      const lat = `${s.lateral.material}-${s.lateral.nominal}`;
      const c = canos.get(lat) || { material: s.lateral.material, nominal: s.lateral.nominal, lateral: 0, alimentacion: 0 };
      // Con el ramal dibujado en el plano, el caño es el largo dibujado y lleva un codo en cada quiebre.
      const ramal = s.ramal && s.ramal.length && s.valvulaPos ? [s.valvulaPos, ...s.ramal] : null;
      c.lateral += ramal ? ramal.slice(1).reduce((t, p, k) => t + Math.hypot(p.x - ramal[k].x, p.y - ramal[k].y), 0)
        : s.aspersores.reduce((t, a) => t + (a.distancia || 0), 0);
      canos.set(lat, c);
      if (ramal && ramal.length > 2)
        sumar(`codo-${s.lateral.material}-${s.lateral.nominal}`, 'Materiales',
          /^pvc/.test(s.lateral.material) ? `Codo de PVC de ${s.lateral.nominal} mm` : `Codo para caño ${tipoLat.nombre} de ${s.lateral.nominal} mm`, 'u', ramal.length - 2);
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
    if (valvulas) {
      sumar('valvula-pgv-1', 'Materiales', 'Electroválvula Hunter PGV-101 de 1"', 'u', valvulas);
      sumar('caja-valvulas', 'Materiales', 'Caja para válvulas con tapa', 'u', 1);
      sumar(`programador-${valvulas}`, 'Materiales', `Programador Hunter de ${valvulas} ${valvulas === 1 ? 'estación' : 'estaciones'}`, 'u', 1);
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
    // Todo lo que muestra el PDF va acá adentro: al cerrar el presupuesto se guarda tal cual, y el PDF
    // de un presupuesto enviado no cambia aunque después se toque el diseño.
    return {
      renglones, quitados, subtotales, subtotal, descuento, descuentoPct: p.descuento || 0, neto, iva, total: neto + iva,
      sinPrecio: renglones.filter(r => !r.precio && r.cantidad).length,
      datos: {
        aspersores: m.aspersores, valvulas: m.valvulas, metrosZanja: m.metrosZanja, m2: m.m2, m2Estimados: m.m2Estimados,
        sectores: obra.sectores.map(s => ({ nombre: s.nombre, aspersores: s.aspersores.length })),
      },
      notas: m.notas,
    };
  }

  const redondear = v => Math.round(v * 100) / 100;
  const pesos = v => '$ ' + Number(v || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  global.PRESUPUESTO = { RUBROS, IVA, superficieEstimada, materialesDeObra, armarPresupuesto, pesos };
})(typeof window !== 'undefined' ? window : globalThis);
