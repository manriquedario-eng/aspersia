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

  function nombreArchivo(obra) {
    const quien = (obra.nombre || obra.cliente?.nombre || 'obra').replace(/[\\/:*?"<>|]/g, '').trim();
    return `Presupuesto ${numeroTexto(obra.presupuesto.numero)} - ${quien}.pdf`;
  }

  global.PDF = { armarPDF, armarListado, nombreArchivo, numeroTexto };
})(typeof window !== 'undefined' ? window : globalThis);
