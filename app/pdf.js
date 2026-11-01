// PDF del presupuesto con el logo y los datos del instalador. Usa jsPDF y jsPDF-AutoTable (app/vendor), sin señal.

(function (global) {
  const AZUL = [11, 74, 143], AZUL_OSCURO = [1, 38, 87], VERDE = [88, 160, 3], GRIS = [90, 107, 128], LINEA = [216, 225, 235];
  let logoCache = null;

  // El logo va en JPEG sobre fondo blanco: en el navegador, jsPDF guarda el PNG casi sin comprimir (el PDF pesaba 600 KB).
  async function logo() {
    if (logoCache) return logoCache;
    try {
      const blob = await (await fetch('app/marca/logo-pdf.png')).blob();
      if (typeof document !== 'undefined' && global.createImageBitmap) {
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(bmp, 0, 0);
        logoCache = { datos: c.toDataURL('image/jpeg', 0.9), formato: 'JPEG' };
      } else {
        const url = await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob); });
        logoCache = { datos: url, formato: 'PNG' };
      }
    } catch { logoCache = null; }
    return logoCache;
  }

  const fechaLarga = iso => {
    if (!iso) return '';
    const [a, m, d] = iso.split('-').map(Number);
    return new Date(a, m - 1, d).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
  };
  const sumarDias = (iso, dias) => {
    const [a, m, d] = iso.split('-').map(Number);
    const f = new Date(a, m - 1, d + Number(dias || 0));
    return f.toISOString().slice(0, 10);
  };
  const numeroTexto = n => String(n).padStart(4, '0');
  const cantidad = v => Number(v).toLocaleString('es-AR', { maximumFractionDigits: 2 });

  // obra, presupuesto armado (PRESUPUESTO.armarPresupuesto), datos del instalador
  async function armarPDF(obra, pre, inst) {
    const { jsPDF } = global.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const P = global.PRESUPUESTO;
    const ancho = 210, margen = 16;
    let y = 14;

    // --- Encabezado: logo y datos del instalador ---
    const img = await logo();
    if (img) doc.addImage(img.datos, img.formato, margen, y, 34, 30, 'logo', 'SLOW');
    doc.setTextColor(...AZUL_OSCURO);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text(inst.comercial || 'Aspersia · Riegos Tecnológicos', ancho - margen, y + 5, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRIS);
    const lineasInst = [inst.nombre, inst.telefono && `Tel. ${inst.telefono}`, inst.correo, inst.direccion, inst.cuit && `CUIT ${inst.cuit}`].filter(Boolean);
    lineasInst.forEach((t, i) => doc.text(t, ancho - margen, y + 11 + i * 4.6, { align: 'right' }));
    y = Math.max(y + 34, y + 13 + lineasInst.length * 4.6);
    doc.setDrawColor(...VERDE); doc.setLineWidth(0.8); doc.line(margen, y, ancho - margen, y);
    y += 9;

    // --- Título ---
    const p = obra.presupuesto;
    doc.setTextColor(...AZUL); doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    doc.text('Presupuesto', margen, y);
    doc.setFontSize(11); doc.setTextColor(...AZUL_OSCURO);
    doc.text(`N° ${numeroTexto(p.numero)}`, ancho - margen, y - 1.5, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRIS);
    doc.text(`Fecha: ${fechaLarga(p.fecha)}`, ancho - margen, y + 3.5, { align: 'right' });
    doc.text(`Válido hasta: ${fechaLarga(sumarDias(p.fecha, p.validez))}`, ancho - margen, y + 8, { align: 'right' });
    y += 13;

    // --- Cliente ---
    const c = obra.cliente || {};
    const filasCliente = [
      ['Cliente', c.nombre], ['Dirección', [c.direccion, c.localidad].filter(Boolean).join(', ')],
      ['Teléfono', c.telefono], ['Correo', c.correo], ['Obra', obra.nombre],
    ].filter(([, v]) => v);
    if (filasCliente.length) {
      doc.autoTable({
        startY: y, margin: { left: margin(), right: margen, bottom: 22 }, theme: 'plain',
        body: filasCliente, styles: { fontSize: 9.5, cellPadding: { top: 0.8, bottom: 0.8, left: 0, right: 2 }, textColor: [19, 35, 58] },
        columnStyles: { 0: { cellWidth: 24, textColor: GRIS } },
      });
      y = doc.lastAutoTable.finalY + 5;
    }
    function margin() { return margen; }

    // --- Resumen técnico ---
    const d = pre.datos;
    // Se usa lo guardado en el presupuesto (no la obra actual): así un presupuesto cerrado siempre da el mismo PDF.
    const listaSectores = d.sectores || obra.sectores.map(s => ({ nombre: s.nombre, aspersores: s.aspersores.length }));
    const sectores = listaSectores.map(s => `${s.nombre} (${s.aspersores})`).join(', ');
    const resumen = d.tipo === 'mantenimiento'
      ? `Mantenimiento y reparación del riego${d.trabajo ? ': ' + d.trabajo.trim().replace(/.$/, '') + '.' : '.'}`
      : `Sistema de riego automático por aspersión Hunter: ${listaSectores.length} sector${listaSectores.length === 1 ? '' : 'es'} ` +
      `(${sectores}), ${d.aspersores} aspersores` + (d.m2 ? ` y unos ${cantidad(d.m2)} m² de superficie regada.` : '.');
    doc.setFillColor(231, 240, 250); doc.setTextColor(...AZUL_OSCURO); doc.setFontSize(9.5);
    const lineasResumen = doc.splitTextToSize(resumen, ancho - 2 * margen - 8);
    doc.roundedRect(margen, y, ancho - 2 * margen, 6 + lineasResumen.length * 4.4, 2, 2, 'F');
    doc.text(lineasResumen, margen + 4, y + 5.5);
    y += 10 + lineasResumen.length * 4.4;

    // --- Detalle por rubro (solo renglones con cantidad y precio) ---
    const cuerpo = [];
    for (const rubro of P.RUBROS) {
      // En mantenimiento, un material sin precio sale igual con "A confirmar según relevamiento" (Darío)
      const aConfirmar = r => pre.datos?.tipo === 'mantenimiento' && r.rubro === 'Materiales' && !r.precio && r.descripcion;
      const rs = pre.renglones.filter(r => r.rubro === rubro && r.cantidad && (r.precio || aConfirmar(r)));
      if (!rs.length) continue;
      cuerpo.push([{ content: rubro, colSpan: 4, styles: { fontStyle: 'bold', textColor: AZUL, fillColor: [242, 246, 250] } },
        { content: pre.opciones ? '' : P.pesos(pre.subtotales[rubro]), styles: { fontStyle: 'bold', textColor: AZUL, fillColor: [242, 246, 250], halign: 'right' } }]);
      for (const r of rs) cuerpo.push(aConfirmar(r)
        ? [r.descripcion, cantidad(r.cantidad), r.unidad, { content: 'A confirmar según relevamiento', colSpan: 2, styles: { halign: 'right', fontStyle: 'italic' } }]
        : [r.descripcion, cantidad(r.cantidad), r.unidad, P.pesos(r.precio), P.pesos(r.importe)]);
    }
    doc.autoTable({
      startY: y, margin: { left: margen, right: margen, bottom: 22 },
      head: [['Descripción', { content: 'Cant.', styles: { halign: 'right' } }, { content: 'Unid.', styles: { halign: 'center' } },
        { content: 'Precio unit.', styles: { halign: 'right' } }, { content: 'Importe', styles: { halign: 'right' } }]],
      body: cuerpo, theme: 'grid',
      headStyles: { fillColor: AZUL, textColor: 255, fontStyle: 'bold', fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 1.8, lineColor: LINEA, lineWidth: 0.2, textColor: [19, 35, 58] },
      columnStyles: { 1: { halign: 'right', cellWidth: 16 }, 2: { halign: 'center', cellWidth: 13 }, 3: { halign: 'right', cellWidth: 28 }, 4: { halign: 'right', cellWidth: 30 } },
    });
    y = doc.lastAutoTable.finalY + 4;

    // --- Totales ---
    const totales = pre.opciones ? [] : [['Subtotal', P.pesos(pre.subtotal)]];
    if (pre.opciones) { if (pre.descuento) totales.push([`Descuento ${cantidad(pre.descuentoPct ?? p.descuento)} %`, 'sobre la opción']); if (pre.iva) totales.push([`IVA ${P.IVA} %`, 'se suma']); }
    else if (pre.totalManual != null) totales.length = 0;
    else if (pre.descuento) totales.push([`Descuento ${cantidad(pre.descuentoPct ?? p.descuento)} %`, '- ' + P.pesos(pre.descuento)]);
    if (!pre.opciones && pre.totalManual == null && pre.iva) totales.push([`IVA ${P.IVA} %`, P.pesos(pre.iva)]);
    if (!pre.opciones && totales.length === 1) totales.length = 0;
    totales.push([{ content: 'TOTAL', styles: { fontStyle: 'bold', fontSize: 12, textColor: 255, fillColor: AZUL } },
      { content: pre.segunOpcion ? 'Según la opción elegida' : P.pesos(pre.total), styles: { fontStyle: 'bold', fontSize: 12, textColor: 255, fillColor: AZUL } }]);
    // Totales a la derecha y condiciones a la izquierda, a la misma altura: así entra todo en una hoja.
    // Si no hay lugar en la hoja, ambos pasan juntos a la siguiente.
    const altoTotales = totales.length * 8.5;
    if (y + Math.max(altoTotales, 30) > 297 - 22) { doc.addPage(); y = 20; }
    const yBloque = y;
    doc.autoTable({
      startY: yBloque, margin: { left: ancho - margen - 80, right: margen, bottom: 22 }, theme: 'plain', body: totales,
      styles: { fontSize: 10, cellPadding: 2, textColor: [19, 35, 58] },
      columnStyles: { 0: { cellWidth: 40 }, 1: { halign: 'right' } },
    });
    const finTotales = doc.lastAutoTable.finalY;

    // --- Condiciones ---
    // Día y hora para hacer la obra (Darío): "sábado 8/11/2026, 9:00 h"
    const diaObra = p.diaObra ? new Date(p.diaObra + 'T12:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' }) + (p.horaObra ? `, ${p.horaObra} h` : '') : '';
    const condiciones = [['Fecha de la obra', diaObra], ['Forma de pago', p.formaPago], ['Datos para el pago', (inst.pago || '').trim()], ['Notas', p.notas], ['Validez', `${p.validez} días desde la fecha del presupuesto.`]].filter(([, v]) => v);
    doc.autoTable({
      startY: yBloque, margin: { left: margen, right: margen + 80 + 6, bottom: 22 }, theme: 'plain', body: condiciones,
      styles: { fontSize: 8.5, cellPadding: { top: 1, bottom: 1, left: 0, right: 3 }, textColor: [19, 35, 58] },
      columnStyles: { 0: { cellWidth: 24, textColor: GRIS, fontStyle: 'bold' } },
    });
    y = Math.max(finTotales, doc.lastAutoTable.finalY);

    // --- Pie en todas las páginas ---
    const paginas = doc.getNumberOfPages();
    for (let i = 1; i <= paginas; i++) {
      doc.setPage(i);
      doc.setDrawColor(...LINEA); doc.setLineWidth(0.3); doc.line(margen, 282, ancho - margen, 282);
      doc.setFontSize(8); doc.setTextColor(...GRIS);
      if (inst.pie) doc.text(doc.splitTextToSize(inst.pie, 150), margen, 286);
      doc.text(`Página ${i} de ${paginas}`, ancho - margen, 286, { align: 'right' });
    }
    return doc.output('blob');
  }

  // Listado de materiales para comprar (al corralón o al proveedor): cantidades, sin precios.
  async function armarListado(obra, pre, inst) {
    const { jsPDF } = global.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const ancho = 210, margen = 16;
    let y = 14;
    const img = await logo();
    if (img) doc.addImage(img.datos, img.formato, margen, y, 22, 19, 'logo', 'SLOW');
    doc.setTextColor(...AZUL); doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    doc.text('Listado de materiales', ancho - margen, y + 7, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRIS);
    const c = obra.cliente || {};
    const lineas = [`Obra N° ${numeroTexto(obra.presupuesto.numero)}${c.nombre ? ' · ' + c.nombre : ''}`,
      [c.direccion, c.localidad].filter(Boolean).join(', '), `Fecha: ${fechaLarga(new Date().toISOString().slice(0, 10))}`,
      inst.comercial || inst.nombre ? `${inst.comercial || 'Aspersia'}${inst.telefono ? ' · Tel. ' + inst.telefono : ''}` : ''].filter(Boolean);
    lineas.forEach((t, i) => doc.text(t, ancho - margen, y + 13 + i * 4.4, { align: 'right' }));
    y = Math.max(y + 24, y + 15 + lineas.length * 4.4);
    doc.setDrawColor(...VERDE); doc.setLineWidth(0.8); doc.line(margen, y, ancho - margen, y);
    y += 6;
    const rs = pre.renglones.filter(r => r.rubro === 'Materiales' && r.cantidad > 0 && (r.descripcion || '').trim());
    doc.autoTable({
      startY: y, margin: { left: margen, right: margen, bottom: 18 }, theme: 'grid',
      head: [['Material', 'Cantidad', 'Unidad', 'Listo']],
      body: rs.map(r => [r.descripcion, cantidad(r.cantidad), r.unidad || '', '']),
      styles: { fontSize: 10, cellPadding: 2.2, textColor: [19, 35, 58], lineColor: LINEA, lineWidth: 0.2 },
      headStyles: { fillColor: AZUL, textColor: 255, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right', cellWidth: 22 }, 2: { halign: 'center', cellWidth: 18 }, 3: { cellWidth: 14 } },
    });
    y = doc.lastAutoTable.finalY + 6;
    doc.setFontSize(8.5); doc.setTextColor(...GRIS);
    doc.text(`${rs.length} materiales. Las cantidades de caño y manguera ya incluyen el desperdicio.`, margen, y);
    return doc.output('blob');
  }

  // ---------- Diagrama de instalación (Darío: con el proyecto validado, que no se le pueda errar en la obra) ----------
  // Hoja 1: el plano dibujado a escala (zonas, bomba, válvulas, caño con su medida por tramo, codos, cuplas con buje,
  // mangueras y cada aspersor con su número y su abanico). Después, por sector: el recorrido del caño y una tabla
  // con cada aspersor en el orden en que lo encuentra el caño.
  const COLORES = ['#0a9ae9', '#8b5cf6', '#f97316', '#14b8a6', '#e11d48', '#ca8a04', '#2563eb', '#58a003'];
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const m1 = v => (Math.round(v * 10) / 10).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  async function armarDiagrama(obra, inst) {
    const { jsPDF } = global.jspdf;
    const O = global.OBRA, G = global.GEOMETRIA, R = global.RIEGO;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const ancho = 210, margen = 14, t = obra.plano;
    O.sincronizarDistancias(obra);
    const asps = O.aspersoresDelPlano(obra);
    const calc = obra.sectores.map(s => O.calcular(obra, s));
    const c = obra.cliente || {};

    // --- Encabezado ---
    doc.setTextColor(...AZUL); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text('Diagrama de instalación', margen, 16);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRIS);
    doc.text([`Obra N° ${numeroTexto(obra.presupuesto.numero)}${c.nombre ? ' · ' + c.nombre : ''}`, [c.direccion, c.localidad].filter(Boolean).join(', ')].filter(Boolean), ancho - margen, 12, { align: 'right' });
    doc.text(`Terreno de ${m1(t.ancho)} × ${m1(t.largo)} m. Medidas en metros. Arriba del plano = arriba de la captura${t.norte ? ` (el norte está a ${Math.round(t.norte)}°)` : ''}.`, margen, 22);

    // --- Plano a escala ---
    const cajaW = ancho - 2 * margen, cajaH = 175, y0 = 27;
    const k = Math.min(cajaW / t.ancho, cajaH / t.largo);
    const ox = margen + (cajaW - t.ancho * k) / 2, oy = y0;
    const X = x => ox + x * k, Y = y => oy + (t.largo - y) * k;
    doc.setDrawColor(...LINEA); doc.setLineWidth(0.2); doc.rect(X(0), Y(t.largo), t.ancho * k, t.largo * k);
    const poligono = (pts, estilo) => { if (pts.length < 2) return; doc.lines(pts.slice(1).map((p, i) => [X(p.x) - X(pts[i].x), Y(p.y) - Y(pts[i].y)]), X(pts[0].x), Y(pts[0].y), [1, 1], estilo, true); };
    const transparente = (op, fn) => { try { doc.setGState(new doc.GState({ opacity: op })); fn(); doc.setGState(new doc.GState({ opacity: 1 })); } catch { fn(); } };
    // Zonas a regar
    for (const z of t.zonas || []) { doc.setFillColor(232, 245, 222); doc.setDrawColor(88, 160, 3); doc.setLineWidth(0.4); poligono(z, 'FD'); }
    // Abanicos (claros, para no tapar el caño)
    for (const a of asps) {
      const col = rgb(COLORES[a.s % COLORES.length]);
      let pts;
      if (a.franja) {
        const g = a.giro * Math.PI / 180, u = { x: Math.sin(g), y: Math.cos(g) }, v = { x: Math.cos(g), y: -Math.sin(g) };
        const [v0, v1] = a.franja === 'SS' ? [-a.radio / 2, a.radio / 2] : a.franja === 'LCS' ? [-a.radio, 0] : [0, a.radio];
        const P = (uu, vv) => ({ x: a.x + u.x * uu + v.x * vv, y: a.y + u.y * uu + v.y * vv });
        pts = [P(0, v0), P(a.ancho, v0), P(a.ancho, v1), P(0, v1)];
      } else {
        const arco = Math.min(360, a.arco), n = Math.max(6, Math.ceil(arco / 8));
        pts = arco >= 360 ? [] : [{ x: a.x, y: a.y }];
        for (let i = 0; i <= n; i++) { const r = (a.giro - arco / 2 + arco * i / n) * Math.PI / 180; pts.push({ x: a.x + a.radio * Math.sin(r), y: a.y + a.radio * Math.cos(r) }); }
      }
      doc.setFillColor(...col); doc.setDrawColor(...col); doc.setLineWidth(0.15);
      transparente(0.12, () => poligono(pts, 'F'));
      transparente(0.5, () => poligono(pts, 'S'));
    }
    // Todo lo que se dibuja queda anotado (cajas y trazos, en mm de la hoja) para que las medidas busquen un lugar
    // libre (Darío: que nada tape nada). Trazo = [x1, y1, x2, y2, medio grosor].
    const ocupado = [], trazos = [], rotulos = [];
    const caja = (x, y, r) => ocupado.push([x - r, y - r, x + r, y + r]);
    const trazar = (x1, y1, x2, y2, grosor) => { doc.line(x1, y1, x2, y2); trazos.push([x1, y1, x2, y2, grosor / 2]); };
    // Medida pegada a un trazo (o a un punto, si las dos puntas coinciden); prioridad: las de menor número eligen primero
    const rotulo = (texto, p, q, color, prioridad, negrita = false) => rotulos.push({ texto, x1: X(p.x), y1: Y(p.y), x2: X(q.x), y2: Y(q.y), color, prioridad, negrita });
    const masLargo = pts => { let m = [pts[0], pts[pts.length - 1]], l = -1; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); if (d > l) { l = d; m = [pts[i - 1], pts[i]]; } } return m; };
    // Caños, mangueras, codos y cambios de medida, con sus cotas
    obra.sectores.forEach((s, ks) => {
      if (!O.tieneRamal(s)) return;
      const linea = [s.valvulaPos, ...s.ramal], largo = G.largoDeLinea(linea);
      const ubic = s.aspersores.filter(a => a.x != null && a.y != null);
      const con = G.conexionesAlRamal(s.valvulaPos, s.ramal, ubic, t.zonas);
      // De una tobera a la siguiente (en el orden del caño), en recta: punteada gris
      doc.setDrawColor(130, 130, 130); doc.setLineWidth(0.15); doc.setLineDashPattern([0.8, 0.8], 0);
      for (let j = 1; j < con.length; j++) {
        const a = ubic[con[j - 1].i], b = ubic[con[j].i], d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d < 0.05) continue;
        trazar(X(a.x), Y(a.y), X(b.x), Y(b.y), 0.15);
        rotulo(`${m1(d)} m`, a, b, [110, 110, 110], 4);
      }
      doc.setLineDashPattern([], 0);
      // Mangueras negras con su largo
      doc.setDrawColor(17, 17, 17); doc.setFillColor(17, 17, 17); doc.setLineWidth(0.3);
      for (const cx of con) {
        const a = ubic[cx.i];
        trazar(X(a.x), Y(a.y), X(cx.punto.x), Y(cx.punto.y), 0.3);
        doc.circle(X(cx.punto.x), Y(cx.punto.y), 0.5, 'F');
        rotulo(`${m1(a.manguera ?? cx.manguera)} m`, a, cx.punto, [17, 17, 17], 3);
      }
      // Caño: blanco con borde negro (como en el plano de la app), más grueso cuanto más diámetro
      const tramos = medidasDelCano(obra, s, calc[ks]);
      for (const tr of tramos) {
        const pts = G.subLinea(linea, tr.desde, tr.hasta), g = Math.max(0.9, tr.nominal / 32);
        for (const [color, w] of [[[17, 17, 17], g + 0.5], [[255, 255, 255], g]]) {
          doc.setDrawColor(...color); doc.setLineWidth(w);
          for (let i = 1; i < pts.length; i++) doc.line(X(pts[i - 1].x), Y(pts[i - 1].y), X(pts[i].x), Y(pts[i].y));
        }
        for (let i = 1; i < pts.length; i++) trazos.push([X(pts[i - 1].x), Y(pts[i - 1].y), X(pts[i].x), Y(pts[i].y), (g + 0.5) / 2]);
        const [p, q] = masLargo(pts);
        rotulo(`Ø ${tr.nominal}`, p, q, [63, 70, 82], 1);
      }
      // Metros de caño entre conexiones (lo que usa el cálculo), y del último aspersor al tapón
      const marcas = [0];
      for (const cx of con) marcas.push(marcas.at(-1) + cx.tramo);
      marcas.push(largo);
      for (let j = 1; j < marcas.length; j++) {
        if (marcas[j] - marcas[j - 1] < 0.1) continue;
        const [p, q] = masLargo(G.subLinea(linea, marcas[j - 1], marcas[j]));
        rotulo(`${m1(marcas[j] - marcas[j - 1])} m`, p, q, [19, 35, 58], 2, true);
      }
      for (let i = 1; i < tramos.length; i++) if (tramos[i].nominal !== tramos[i - 1].nominal) {
        const p = G.subLinea(linea, tramos[i].desde, tramos[i].desde)[0];
        doc.setFillColor(255, 255, 255); doc.setDrawColor(224, 168, 0); doc.setLineWidth(0.5); doc.circle(X(p.x), Y(p.y), 1.3, 'FD');
        caja(X(p.x), Y(p.y), 1.5);
      }
      s.ramal.forEach((p, i) => {
        doc.setFillColor(255, 255, 255); doc.setDrawColor(17, 17, 17); doc.setLineWidth(0.3); doc.rect(X(p.x) - 0.9, Y(p.y) - 0.9, 1.8, 1.8, 'FD');
        caja(X(p.x), Y(p.y), 1.1);
        rotulo(i === s.ramal.length - 1 ? 'Tapón' : `C${i + 1}`, p, p, [63, 70, 82], 0);
      });
    });
    // Bomba y válvulas
    const f = t.fuente;
    if (f && t.bombaUbicada !== false) {
      doc.setFillColor(...AZUL); doc.triangle(X(f.x), Y(f.y) - 2, X(f.x) - 1.8, Y(f.y) + 1.2, X(f.x) + 1.8, Y(f.y) + 1.2, 'F');
      caja(X(f.x), Y(f.y), 2.1);
      rotulo(obra.fuente.tipo === 'bomba' ? 'Bomba' : 'Canilla', f, f, AZUL, 0);
    }
    obra.sectores.forEach((s, ks) => {
      if (!s.valvulaPos) return;
      doc.setFillColor(...rgb(COLORES[ks % COLORES.length])); doc.rect(X(s.valvulaPos.x) - 1.1, Y(s.valvulaPos.y) - 1.1, 2.2, 2.2, 'F');
      caja(X(s.valvulaPos.x), Y(s.valvulaPos.y), 1.2);
      doc.setFontSize(6); doc.setTextColor(255, 255, 255); doc.text(String(ks + 1), X(s.valvulaPos.x), Y(s.valvulaPos.y) + 0.8, { align: 'center' });
    });
    // Aspersores con su número (sector.número)
    for (const a of asps) {
      doc.setFillColor(...rgb(COLORES[a.s % COLORES.length])); doc.circle(X(a.x), Y(a.y), 1.9, 'F');
      caja(X(a.x), Y(a.y), 2.1);
      doc.setFontSize(5.5); doc.setTextColor(255, 255, 255); doc.text(`${a.s + 1}.${a.num}`, X(a.x), Y(a.y) + 0.7, { align: 'center' });
    }
    // Cada medida busca, cerca de lo que mide, el primer lugar donde no toca ninguna línea, símbolo ni otra medida
    // (si no hay ninguno, el que menos toca). Si quedó lejos, una línea fina la une con lo que mide.
    const corta = ([x1, y1, x2, y2, m], [a, b, c, d]) => {   // segmento contra caja agrandada por el grosor (Liang-Barsky)
      a -= m; b -= m; c += m; d += m;
      let t0 = 0, t1 = 1;
      const dx = x2 - x1, dy = y2 - y1;
      for (const [p, q] of [[-dx, x1 - a], [dx, c - x1], [-dy, y1 - b], [dy, d - y1]]) {
        if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
        const r = q / p;
        if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
      }
      return true;
    };
    const choques = r => (r[0] < margen || r[2] > ancho - margen || r[1] < y0 || r[3] > y0 + cajaH ? 100 : 0)
      + ocupado.filter(o => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1]).length
      + trazos.filter(s => corta(s, r)).length;
    const DIR = [[1, 0], [0, 1], [-1, 0], [0, -1], [0.71, 0.71], [-0.71, 0.71], [0.71, -0.71], [-0.71, -0.71]];
    rotulos.sort((p, q) => p.prioridad - q.prioridad);
    for (const r of rotulos) {
      doc.setFont('helvetica', r.negrita ? 'bold' : 'normal'); doc.setFontSize(6);
      const w = doc.getTextWidth(r.texto) + 0.8, h = 2.6;
      const dx = r.x2 - r.x1, dy = r.y2 - r.y1, L = Math.hypot(dx, dy), lugares = [];
      if (L < 0.5) {
        for (const d of [0.6, 2, 4]) for (const [ux, uy] of DIR) lugares.push({ x: r.x1 + ux * (d + Math.abs(ux) * w / 2 + Math.abs(uy) * h / 2), y: r.y1 + uy * (d + Math.abs(ux) * w / 2 + Math.abs(uy) * h / 2), ax: r.x1, ay: r.y1, d });
      } else {
        const nx = -dy / L, ny = dx / L, ext = Math.abs(nx) * w / 2 + Math.abs(ny) * h / 2;
        for (const d of [0.4, 1.8, 3.5, 6]) for (const f of [0.5, 0.35, 0.65, 0.2, 0.8]) for (const lado of [1, -1])
          lugares.push({ x: r.x1 + dx * f + nx * lado * (d + ext), y: r.y1 + dy * f + ny * lado * (d + ext), ax: r.x1 + dx * f, ay: r.y1 + dy * f, d });
      }
      let mejor = null;
      for (const l of lugares) {
        const c = [l.x - w / 2, l.y - h / 2, l.x + w / 2, l.y + h / 2], n = choques(c);
        if (!mejor || n < mejor.n) mejor = { ...l, c, n };
        if (!n) break;
      }
      ocupado.push(mejor.c);
      r.lugar = mejor;
    }
    for (const r of rotulos) if (r.lugar.d >= 3.5) { doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.12); doc.line(r.lugar.ax, r.lugar.ay, r.lugar.x, r.lugar.y); }
    for (const r of rotulos) {
      const { c } = r.lugar;
      doc.setFillColor(255, 255, 255); doc.rect(c[0], c[1], c[2] - c[0], c[3] - c[1], 'F');
      doc.setFont('helvetica', r.negrita ? 'bold' : 'normal'); doc.setFontSize(6); doc.setTextColor(...r.color);
      doc.text(r.texto, r.lugar.x, r.lugar.y, { align: 'center', baseline: 'middle' });
    }
    doc.setFont('helvetica', 'normal');
    // Referencias
    let y = oy + t.largo * k + 5;
    doc.setFontSize(7.5); doc.setTextColor(...GRIS);
    doc.text('Referencias: 1.3 = sector 1, aspersor 3 · cuadrado de color = válvula del sector · C1, C2 = codos · círculo amarillo = cupla con buje de reducción · línea blanca con borde negro = caño (más gruesa = más diámetro; Ø = medida en mm) · línea negra = manguera.', margen, y, { maxWidth: cajaW });
    y += 7.5;
    doc.text('Cotas en metros: en negrita, metros de caño entre una conexión y la siguiente (y hasta el tapón) · en negro, al lado de cada manguera, su largo · en gris, sobre la línea punteada, de una tobera a la siguiente en línea recta.', margen, y, { maxWidth: cajaW });
    y += 9;
    doc.setFontSize(8);
    obra.sectores.forEach((s, ks) => {
      doc.setFillColor(...rgb(COLORES[ks % COLORES.length])); doc.rect(margen, y - 2.4, 3, 3, 'F');
      doc.setTextColor(19, 35, 58); doc.text(s.nombre || `Sector ${ks + 1}`, margen + 4.5, y);
      y += 4.5;
    });

    // --- Por sector: recorrido del caño y aspersores ---
    obra.sectores.forEach((s, ks) => {
      const cs = calc[ks];
      doc.addPage(); y = 16;
      doc.setTextColor(...rgb(COLORES[ks % COLORES.length])); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
      doc.text(s.nombre || `Sector ${ks + 1}`, margen, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRIS);
      const r = cs.r;
      const val = r?.valvula ? `Electroválvula Hunter ${r.valvula.modelo} de ${r.valvula.medida}` : 'Sin electroválvula';
      doc.text([`${val}. ${r ? `Caudal del sector: ${Math.round(r.caudalTotal ?? r.total ?? 0)} l/min.` : ''}`, cs.error ? `Ojo: ${cs.error}` : ''].filter(Boolean), margen, y + 6);
      y += 13;
      if (!s.aspersores.length) { doc.text('Sin aspersores.', margen, y); return; }
      // Recorrido del caño
      const filasCano = [];
      if (O.tieneRamal(s)) {
        const linea = [s.valvulaPos, ...s.ramal], tramos = medidasDelCano(obra, s, cs);
        const nombreP = i => i === 0 ? 'Válvula' : i === linea.length - 1 ? 'Final (tapón)' : `Codo C${i}`;
        let acum = 0;
        for (let i = 1; i < linea.length; i++) {
          const largo = Math.hypot(linea[i].x - linea[i - 1].x, linea[i].y - linea[i - 1].y);
          const medidas = [...new Set(tramos.filter(tr => tr.hasta > acum + 1e-6 && tr.desde < acum + largo - 1e-6).map(tr => tr.nominal))];
          filasCano.push([`${nombreP(i - 1)} a ${nombreP(i).charAt(0).toLowerCase()}${nombreP(i).slice(1)}`, m1(largo), m1(acum + largo), medidas.map(d => d + ' mm').join(' y luego ')]);
          acum += largo;
        }
        for (let i = 1; i < tramos.length; i++) if (tramos[i].nominal !== tramos[i - 1].nominal)
          filasCano.push([{ content: `Cupla de ${Math.max(tramos[i].nominal, tramos[i - 1].nominal)} mm + buje de reducción a ${Math.min(tramos[i].nominal, tramos[i - 1].nominal)} mm`, colSpan: 2 }, m1(tramos[i].desde), 'a esa distancia de la válvula']);
      }
      if (filasCano.length) {
        doc.autoTable({ startY: y, margin: { left: margen, right: margen }, theme: 'grid',
          head: [['Caño principal', 'Metros', 'Desde la válvula', 'Medida']], body: filasCano,
          styles: { fontSize: 8.5, cellPadding: 1.6, lineColor: LINEA, lineWidth: 0.2, textColor: [19, 35, 58] }, headStyles: { fillColor: [63, 70, 82], textColor: 255 },
          columnStyles: { 1: { halign: 'right', cellWidth: 18 }, 2: { halign: 'right', cellWidth: 28 } } });
        y = doc.lastAutoTable.finalY + 5;
      }
      // Aspersores en el orden del caño
      let acum = 0, ant = null;
      const filas = s.aspersores.map((a, i) => {
        acum += a.distancia || 0;
        const ra = r?.aspersores?.[i];
        const recta = ant && a.x != null && ant.x != null ? m1(Math.hypot(a.x - ant.x, a.y - ant.y)) : '-';
        if (a.x != null) ant = a;
        let nombreE = `${a.tipo} ${a.boquilla}`;
        try { nombreE = R.emisor(O.idEmisor(a)).nombre; } catch { /* queda el tipo y la boquilla */ }
        return [`${ks + 1}.${O.numero(s, i)}`, `${nombreE}${a.regulador ? ' + ' + a.regulador : ''}`, a.arco ? `${Math.round(a.arco)}°` : '-', a.x != null ? `${Math.round(a.giro || 0)}°` : '-',
          m1(acum), m1(a.manguera || 0), recta, a.x != null ? `${m1(a.x)} ; ${m1(a.y)}` : 'sin ubicar', ra ? (Math.round(ra.presionBoquilla * 100) / 100).toLocaleString('es-AR') : '-'];
      });
      doc.autoTable({ startY: y, margin: { left: margen, right: margen }, theme: 'grid',
        head: [['N°', 'Aspersor y boquilla', 'Arco', 'Apunta', 'Por el caño desde la válvula (m)', 'Manguera (m)', 'Al anterior en recta (m)', 'X ; Y (m)', 'Presión (bar)']], body: filas,
        styles: { fontSize: 7.5, cellPadding: 1.4, lineColor: LINEA, lineWidth: 0.2, textColor: [19, 35, 58] }, headStyles: { fillColor: AZUL, textColor: 255, fontSize: 7 },
        columnStyles: { 0: { cellWidth: 9, fontStyle: 'bold' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 8: { halign: 'right' } } });
      y = doc.lastAutoTable.finalY + 4;
      doc.setFontSize(7.5); doc.setTextColor(...GRIS);
      doc.text('"Apunta": hacia dónde mira el centro del abanico (0° = arriba del plano, 90° = derecha). X ; Y: desde la esquina de abajo a la izquierda del terreno. Cada aspersor se pincha en el caño con conector inicial, manguera y espiga en L.', margen, y, { maxWidth: ancho - 2 * margen });
    });
    return doc.output('blob');
  }
  // Medida del caño a lo largo del ramal: [{desde, hasta, nominal}] (por tramo dibujado o por aspersor si es automático)
  function medidasDelCano(obra, s, cs) {
    const O = global.OBRA, G = global.GEOMETRIA;
    const porTramo = O.tramosDelRamal(s);
    if (porTramo) return porTramo.reduce((l, tr) => { if (l.length && l.at(-1).nominal === tr.nominal) l.at(-1).hasta = tr.hasta; else l.push({ desde: tr.desde, hasta: tr.hasta, nominal: tr.nominal }); return l; }, []);
    const diam = O.diametrosDelSector(obra, s), largo = G.largoDeLinea([s.valvulaPos, ...s.ramal]);
    const res = [];
    let acum = 0;
    s.aspersores.forEach((a, i) => {
      const d = diam[i] ?? s.lateral.nominal, hasta = acum + (a.distancia || 0);
      if (res.length && res.at(-1).nominal === d) res.at(-1).hasta = hasta; else res.push({ desde: acum, hasta, nominal: d });
      acum = hasta;
    });
    if (!res.length) return [{ desde: 0, hasta: largo, nominal: s.lateral.nominal }];
    res.at(-1).hasta = Math.max(res.at(-1).hasta, largo);
    return res;
  }

  function nombreArchivo(obra) {
    const quien = (obra.nombre || obra.cliente?.nombre || 'obra').replace(/[\\/:*?"<>|]/g, '').trim();
    return `Presupuesto ${numeroTexto(obra.presupuesto.numero)} - ${quien}.pdf`;
  }

  global.PDF = { armarPDF, armarListado, armarDiagrama, nombreArchivo, numeroTexto };
})(typeof window !== 'undefined' ? window : globalThis);
