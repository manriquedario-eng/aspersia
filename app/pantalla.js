// Pantallas de Aspersia. Navegación por la dirección (#/...), así el botón atrás del teléfono funciona:
//   #/                         obras
//   #/obra/<id>/<pestaña>      cliente | diseno | presupuesto
//   #/obra/<id>/sector/<n>     un sector de la obra
//   #/precios  #/datos  #/copia
// Usa RIEGO (cálculo), PRESUPUESTO (materiales y totales), ALMACEN (guardado) y PDF.

(function () {
  const R = window.RIEGO, P = window.PRESUPUESTO, A = window.ALMACEN, C = window.CZERWENY;
  const $ = id => document.getElementById(id);
  const fmt = R.fmt;

  const datos = A.cargar();
  let obra = null;          // obra abierta
  let nSector = null;       // índice del sector abierto
  let pendiente = null;
  // Guarda enseguida y marca la obra como modificada.
  const guardar = () => {
    if (obra) obra.actualizada = A.hoy();
    clearTimeout(pendiente);
    pendiente = setTimeout(() => A.guardar(datos), 150);
  };
  window.addEventListener('pagehide', () => A.guardar(datos));

  // ---------- Utilidades ----------
  const opciones = (sel, items, valor) => {
    sel.innerHTML = items.map(([v, t]) => `<option value="${escapar(v)}">${escapar(t)}</option>`).join('');
    if (valor != null && items.some(([v]) => String(v) === String(valor))) sel.value = valor;
    return sel.value;
  };
  // Los campos numéricos del teléfono entregan el decimal con punto ("1500.5"); se acepta también la coma.
  const decimal = v => { const x = parseFloat(String(v).replace(',', '.')); return Number.isFinite(x) ? x : 0; };
  const escapar = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const materiales = Object.entries(R.CANOS).map(([k, c]) => [k, c.nombre]);
  const diametros = mat => Object.keys(R.CANOS[mat].di).map(n => [n, `${n} mm`]);
  const nombreObra = o => o.nombre || (o.cliente.nombre ? `Obra de ${o.cliente.nombre}` : 'Obra sin nombre');
  const cerrado = () => !!obra.presupuesto.congelado;

  // Botón que pide un segundo toque para confirmar (sin ventanas emergentes).
  function confirmarConSegundoToque(boton, accion) {
    const texto = boton.textContent;
    boton.addEventListener('click', () => {
      if (boton.dataset.armado) { delete boton.dataset.armado; boton.textContent = texto; accion(); return; }
      boton.dataset.armado = '1'; boton.textContent = 'Tocá de nuevo para confirmar';
      setTimeout(() => { delete boton.dataset.armado; boton.textContent = texto; }, 4000);
    });
  }

  // ---------- Catálogo de aspersores para los menús ----------
  const EMISORES = R.emisores();
  const TIPOS = [...new Set(EMISORES.map(e => e.tipo))];
  const deTipo = tipo => EMISORES.filter(e => e.tipo === tipo);
  const boquillas = tipo => [...new Set(deTipo(tipo).map(e => e.boquilla))];
  const arcos = (tipo, boq) => deTipo(tipo).filter(e => e.boquilla === boq && e.arco != null).map(e => e.arco);
  const esAjustable = a => a.tipo === R.TIPO_AJUSTABLE;
  const arcoLibre = a => esAjustable(a) || a.tipo === 'Turbina PGP Ultra';   // en la PGP el arco solo cuenta para la superficie
  function idEmisor(a) {
    if (esAjustable(a)) return `pro-${a.boquilla}@${a.arco}`;
    const e = EMISORES.find(e => e.tipo === a.tipo && e.boquilla === a.boquilla && (e.arco == null || e.arco === Number(a.arco)));
    return e && e.id;
  }
  function etiquetaBoquilla(tipo, boq) {
    const e = deTipo(tipo).find(x => x.boquilla === boq);
    const r = e.radios[Math.floor(e.radios.length / 2)];
    const nombre = e.tipo.startsWith('Turbina PGP Ultra') && e.arco == null ? e.nombre : boq;
    return `${nombre} · alcance ${fmt(r, 1)} m`;
  }

  // ---------- Cálculo ----------
  const sectorParaCalcular = o => s => ({
    fuente: o.fuente.tipo === 'bomba'
      ? { tipo: 'bomba', linea: o.fuente.linea, modelo: o.fuente.modelo, aspiracion: o.fuente.aspiracion }
      : { tipo: 'presion', bar: o.fuente.bar },
    alimentacion: s.alimentacion, valvula: s.valvula, lateral: s.lateral,
    aspersores: s.aspersores.map(a => ({ emisor: idEmisor(a), regulador: a.regulador || null, distancia: a.distancia, altura: a.altura })),
    accesorios: o.accesorios,
  });
  function calcular(s) {
    try {
      const d = sectorParaCalcular(obra)(s);
      return { r: R.calcularSector(d), rec: R.recomendarDiametro(d) };
    } catch (err) { return { error: err.message }; }
  }
  const presupuestoDe = o => P.armarPresupuesto(o, datos.precios, sectorParaCalcular(o));
  const peorNivel = c => c.error ? 'error' : ['error', 'aviso', 'info'].find(n => c.r.avisos.some(a => a.nivel === n)) || 'bien';
  const ESTADO_SECTOR = { error: 'Hay problemas', aviso: 'Revisar avisos', info: 'Bien, con notas', bien: 'Todo bien' };
  const CLASE_ESTADO = { Borrador: 'info', Enviado: 'aviso', Aceptado: 'bien', Terminado: 'bien', Rechazado: 'error' };

  // =====================================================================
  // Navegación
  // =====================================================================
  const VISTAS = ['inicio', 'obra', 'sector', 'precios', 'datos', 'copia'];
  function mostrar(vista) {
    for (const v of VISTAS) $(`vista-${v}`).hidden = v !== vista;
    window.scrollTo(0, 0);
  }
  const ir = hash => { if (location.hash === hash) rutear(); else location.hash = hash; };

  function rutear() {
    A.guardar(datos);
    PLANO3D.cerrar();       // la vista 3D usa la placa de video: se libera al salir del plano
    const partes = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const [seccion, id, sub, n] = partes;
    if (seccion === 'obra') {
      obra = datos.obras.find(o => o.id === id);
      if (!obra) return ir('#/');
      if (sub === 'sector') {
        const i = Number(n) - 1;
        if (!(i >= 0 && i < obra.sectores.length)) return ir(`#/obra/${obra.id}/diseno`);
        return abrirSector(i);
      }
      return abrirObra(['cliente', 'diseno', 'plano', 'presupuesto'].includes(sub) ? sub : 'diseno');
    }
    obra = null;
    if (seccion === 'precios') { mostrar('precios'); subtitulo('Lista de precios'); return pintarPrecios(); }
    if (seccion === 'datos') { mostrar('datos'); subtitulo('Mis datos'); return pintarDatos(); }
    if (seccion === 'copia') { mostrar('copia'); subtitulo('Copia de seguridad'); return pintarCopia(); }
    mostrar('inicio'); subtitulo('Riegos Tecnológicos'); pintarInicio();
  }
  const subtitulo = t => $('subtitulo').textContent = t;
  window.addEventListener('hashchange', rutear);

  // =====================================================================
  // Inicio: lista de obras
  // =====================================================================
  function pintarInicio() {
    const obras = [...datos.obras].sort((a, b) => (b.actualizada || '').localeCompare(a.actualizada || ''));
    $('lista-obras').innerHTML = obras.length ? obras.map(o => {
      let total = '';
      try { const p = presupuestoDe(o); if (p.total) total = ` · ${P.pesos(p.total)}`; } catch { /* sin total */ }
      const lugar = [o.cliente.nombre, o.cliente.localidad].filter(Boolean).join(' · ');
      return `<li><a class="sector-tarjeta" href="#/obra/${o.id}/diseno">
        <span class="sector-nombre">${escapar(nombreObra(o))}</span>
        <span class="sector-datos">${escapar(lugar || 'Sin datos del cliente')}</span>
        <span class="sector-datos">N° ${PDF.numeroTexto(o.presupuesto.numero)} · ${o.sectores.length} sector${o.sectores.length === 1 ? '' : 'es'}${total}</span>
        <span class="estado ${CLASE_ESTADO[o.estado] || 'info'}">${escapar(o.estado)}</span>
      </a></li>`;
    }).join('') : '<li class="vacio"><b>Empezá tu primera obra</b><span>Cargá el cliente, diseñá los sectores y armá el presupuesto.</span></li>';
  }
  $('nueva-obra').addEventListener('click', () => {
    const o = A.obraNueva(datos);
    datos.obras.push(o);
    A.guardar(datos);
    ir(`#/obra/${o.id}/cliente`);
  });

  // =====================================================================
  // Obra: pestañas Cliente, Diseño y Presupuesto
  // =====================================================================
  let pestana = 'diseno';
  function abrirObra(p) {
    pestana = p;
    nSector = null;
    mostrar('obra');
    subtitulo(nombreObra(obra));
    document.querySelectorAll('[data-pestana]').forEach(a => {
      a.href = `#/obra/${obra.id}/${a.dataset.pestana}`;
      a.setAttribute('aria-selected', a.dataset.pestana === p);
    });
    for (const panel of ['cliente', 'diseno', 'plano', 'presupuesto']) $(`panel-${panel}`).hidden = panel !== p;
    if (p === 'cliente') pintarCliente();
    if (p === 'diseno') { armarFuente(); pintarDiseno(); $('consulta-resultado').textContent = ''; }
    if (p === 'plano') abrirPlano();
    if (p === 'presupuesto') pintarPresupuesto();
  }

  // =====================================================================
  // Plano
  // =====================================================================
  const GEO = window.GEOMETRIA;
  const r1 = v => Math.round(v * 10) / 10;
  const usaPlano = () => obra.plano && obra.plano.distanciasDesdePlano;

  // Aspersores con lo que hace falta para dibujarlos: posición, giro, alcance real (con la presión que les llega) y arco.
  function aspersoresDelPlano() {
    const lista = [];
    obra.sectores.forEach((s, k) => {
      const c = calcular(s);
      s.aspersores.forEach((a, i) => {
        const e = R.emisor(idEmisor(a));
        const radio = c.r ? c.r.aspersores[i].radio : e.radios[Math.floor(e.radios.length / 2)];
        const franja = e.tipo === 'MP Rotator de franja' ? (/LCS/.test(e.boquilla) ? 'LCS' : /RCS/.test(e.boquilla) ? 'RCS' : 'SS') : null;
        const arco = e.arco ?? a.arco ?? 360;
        lista.push({ s: k, i, x: a.x, y: a.y, giro: a.giro || 0, radio, arco, franja, ancho: 1.5, nombre: e.nombre, trayectoria: trayectoria(e) });
      });
    });
    return lista;
  }

  // Ángulo de salida del chorro, para la vista 3D. Pro fijas y ajustables: el del catálogo (págs. 74 a 78).
  // PGP Ultra: 25° la estándar y 13° la de ángulo bajo (pág. 22). MP Rotator no lo publica: se usan unos 15°.
  function trayectoria(e) {
    const H = window.HUNTER;
    if (e.tipo === 'Boquilla Pro fija' || e.tipo === R.TIPO_AJUSTABLE) {
      const b = [...H.proFijas.boquillas, ...H.proAjustables.boquillas].find(x => x.modelo === e.boquilla);
      return b ? b.trayectoria : 15;
    }
    if (e.tipo.startsWith('Turbina PGP Ultra')) return /ángulo bajo/i.test(e.nombre) ? 13 : 25;
    if (e.tipo === 'MP Rotator de franja') return 8;
    return 15;
  }

  // ---------- Vista 3D ----------
  let modoPlano = '2d';
  function cambiarModoPlano(modo) {
    modoPlano = modo;
    document.querySelectorAll('[data-modo]').forEach(b => b.setAttribute('aria-selected', b.dataset.modo === modo));
    $('plano-2d-caja').hidden = modo !== '2d';
    $('plano-3d-caja').hidden = modo !== '3d';
    $('plano-seleccion').hidden = modo !== '2d';
    if (modo === '3d') abrir3D(); else { PLANO3D.cerrar(); PLANO.iniciar(planoActual()); }
  }
  function abrir3D() {
    const solo = PLANO.soloSector();
    const asps = aspersoresDelPlano().filter(a => solo == null || a.s === solo);
    PLANO3D.abrir($('plano-3d'), {
      terreno: obra.plano, aspersores: asps, fuente: obra.plano.fuente,
      sectores: obra.sectores.map((s, k) => ({ ...s, visible: solo == null || k === solo })),
      colorSector: PLANO.colorSector, conCobertura: obra.plano.verCobertura,
    }).catch(err => { $('plano-3d').innerHTML = `<p class="ayuda">${escapar(err.message)}</p>`; });
  }
  document.querySelectorAll('[data-modo]').forEach(b => b.addEventListener('click', () => cambiarModoPlano(b.dataset.modo)));
  $('encuadrar-3d').addEventListener('click', () => PLANO3D.encuadrar());
  $('agua-3d').addEventListener('click', ev => { const corre = PLANO3D.alternarAgua(); ev.currentTarget.style.opacity = corre ? 1 : 0.45; });
  // Al elegir otro sector en el filtro o cambiar la cobertura, el 3D se rearma con lo que se ve.
  $('plano-filtro').addEventListener('click', () => { if (modoPlano === '3d') setTimeout(abrir3D, 0); });

  // Con "calcular los caños con las distancias del plano", las distancias y el largo hasta cada válvula salen de las posiciones.
  function sincronizarDistancias() {
    if (!usaPlano()) return;
    GEO.ubicarSinPosicion(obra.plano, obra.sectores);
    const f = obra.plano.fuente;
    for (const s of obra.sectores) {
      GEO.distanciasDesdePlano(s.valvulaPos, s.aspersores).forEach((d, i) => s.aspersores[i].distancia = d);
      s.alimentacion.largo = r1(Math.hypot(s.valvulaPos.x - f.x, s.valvulaPos.y - f.y));
    }
  }

  function abrirPlano() {
    GEO.ubicarSinPosicion(obra.plano, obra.sectores);
    sincronizarDistancias();
    $('plano-ancho').value = obra.plano.ancho;
    $('plano-largo').value = obra.plano.largo;
    $('plano-distancias').checked = usaPlano();
    $('plano-cobertura').checked = obra.plano.verCobertura;
    guardar();
    PLANO.iniciar(planoActual());
    cambiarModoPlano(modoPlano);
  }
  const medidaTerreno = (campo, v) => {
    obra.plano[campo] = Math.max(1, Math.min(500, decimal(v)));
    for (const s of obra.sectores) for (const p of [s.valvulaPos, ...s.aspersores]) if (p) {
      p.x = Math.min(obra.plano.ancho, p.x ?? 0); p.y = Math.min(obra.plano.largo, p.y ?? 0);
    }
    sincronizarDistancias(); guardar();
    PLANO.iniciar({ ...planoActual() });
  };
  const planoActual = () => ({
    obra, svg: $('plano-svg'), botones: $('plano-botones'), seleccion: $('plano-seleccion'),
    estadisticas: $('plano-estadisticas'), filtro: $('plano-filtro'), aspersores: aspersoresDelPlano,
    alCambiar: () => { sincronizarDistancias(); guardar(); },
  });
  $('plano-ancho').addEventListener('change', ev => medidaTerreno('ancho', ev.target.value));
  $('plano-largo').addEventListener('change', ev => medidaTerreno('largo', ev.target.value));
  $('plano-distancias').addEventListener('change', ev => { obra.plano.distanciasDesdePlano = ev.target.checked; sincronizarDistancias(); guardar(); PLANO.pintar(); });
  $('plano-cobertura').addEventListener('change', ev => {
    obra.plano.verCobertura = ev.target.checked; guardar();
    if (modoPlano === '3d') abrir3D(); else PLANO.pintar();
  });

  // =====================================================================
  // Consultar a Claude: resumen técnico para pegar en la app de Claude
  // =====================================================================
  function resumenParaClaude() {
    const L = [];
    L.push('Sos un especialista en riego por aspersión residencial con productos Hunter. Revisá este diseño y decime qué mejorarías (boquillas, presiones, caños, cobertura, sectorización). Respondé en castellano.');
    L.push('');
    L.push(`OBRA: ${nombreObra(obra)}${obra.cliente.localidad ? ` (${obra.cliente.localidad})` : ''}`);
    L.push(obra.fuente.tipo === 'bomba'
      ? `Fuente: bomba Czerweny ${obra.fuente.modelo}, altura de aspiración ${fmt(obra.fuente.aspiracion, 1)} m.`
      : `Fuente: red con ${fmt(obra.fuente.bar, 1)} bar disponibles con el agua corriendo.`);
    if (obra.plano) L.push(`Terreno del plano: ${fmt(obra.plano.ancho, 1)} × ${fmt(obra.plano.largo, 1)} m.`);
    obra.sectores.forEach((s, k) => {
      const c = calcular(s);
      L.push('');
      L.push(`SECTOR ${k + 1}: ${s.nombre}${s.superficie ? ` · ${fmt(s.superficie, 0)} m²` : ''}`);
      L.push(`Caño hasta la válvula: ${R.CANOS[s.alimentacion.material].nombre} ${s.alimentacion.nominal} mm, ${fmt(s.alimentacion.largo, 1)} m, desnivel ${fmt(s.alimentacion.desnivel, 1)} m. Válvula PGV 1": ${s.valvula ? 'sí' : 'no'}. Caño del sector: ${R.CANOS[s.lateral.material].nombre} ${s.lateral.nominal} mm.`);
      if (c.error) { L.push(`Error de cálculo: ${c.error}`); return; }
      c.r.aspersores.forEach((a, i) => {
        const asp = s.aspersores[i];
        L.push(`  ${a.n}. ${a.emisor.tipo} ${a.emisor.nombre}${a.regulador ? ` en cuerpo ${a.regulador}` : ''} · a ${fmt(asp.distancia, 1)} m del anterior · ` +
          `${fmt(a.presionBoquilla, 2)} bar en la boquilla · ${fmt(a.caudal, 2)} l/min · alcance ${fmt(a.radio, 1)} m` +
          (asp.x != null ? ` · posición (${fmt(asp.x, 1)}; ${fmt(asp.y, 1)}) m, giro ${Math.round(asp.giro || 0)}°` : ''));
      });
      L.push(`Total del sector: ${fmt(c.r.caudalTotal, 1)} l/min · variación de presión ${fmt(c.r.variacion, 0)} % · caño recomendado ${c.rec.recomendado ? c.rec.recomendado + ' mm' : 'ninguno cumple'}.`);
      for (const a of c.r.avisos) L.push(`  Aviso (${a.nivel}): ${a.texto}`);
    });
    if (obra.plano && obra.sectores.every(s => s.aspersores.every(a => a.x != null))) {
      const cob = GEO.cobertura(obra.plano, aspersoresDelPlano());
      L.push('');
      L.push(`COBERTURA DEL PLANO (todos los sectores): ${fmt(cob.seco, 0)} % seco, ${fmt(cob.uno, 0)} % con un solo aspersor, ${fmt(cob.bien, 0)} % bien cubierto.`);
    }
    L.push('');
    L.push('Datos calculados con Aspersia (catálogo Hunter 2026, curvas Czerweny, pérdidas por Hazen-Williams).');
    return L.join('\n');
  }
  $('consultar-claude').addEventListener('click', async () => {
    const texto = resumenParaClaude();
    const fin = t => $('consulta-resultado').textContent = t;
    if (navigator.share) {
      try { await navigator.share({ title: `Consulta de riego: ${nombreObra(obra)}`, text: texto }); return fin('Listo. Pegalo o compartilo con Claude.'); }
      catch (err) { if (err.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(texto); fin('Copiado. Abrí la app de Claude y pegalo en un mensaje nuevo.'); }
    catch { fin('No se pudo copiar automáticamente.'); }
  });

  // ---------- Cliente ----------
  function pintarCliente() {
    document.querySelectorAll('[data-cliente]').forEach(i => i.value = obra.cliente[i.dataset.cliente] || '');
    $('obra-nombre').value = obra.nombre;
    $('obra-nombre').placeholder = obra.cliente.nombre ? `Casa ${obra.cliente.nombre.trim().split(' ').at(-1)}` : 'Casa Pérez';
    opciones($('obra-estado'), A.ESTADOS.map(e => [e, e]), obra.estado);
  }
  document.querySelectorAll('[data-cliente]').forEach(i => i.addEventListener('input', () => {
    obra.cliente[i.dataset.cliente] = i.value;
    if (i.dataset.cliente === 'nombre') $('obra-nombre').placeholder = i.value ? `Casa ${i.value.trim().split(' ').at(-1)}` : 'Casa Pérez';
    subtitulo(nombreObra(obra)); guardar();
  }));
  $('obra-nombre').addEventListener('input', ev => { obra.nombre = ev.target.value; subtitulo(nombreObra(obra)); guardar(); });
  $('obra-estado').addEventListener('change', ev => cambiarEstado(ev.target.value));

  // Enviado, Aceptado o Terminado cierran el presupuesto; Borrador lo reabre.
  function cambiarEstado(estado) {
    obra.estado = estado;
    if (estado === 'Borrador') obra.presupuesto.congelado = null;
    else if (['Enviado', 'Aceptado', 'Terminado'].includes(estado) && !obra.presupuesto.congelado)
      obra.presupuesto.congelado = { ...presupuestoDe(obra), fechaCierre: A.hoy() };
    guardar();
  }
  $('duplicar-obra').addEventListener('click', () => {
    const copia = JSON.parse(JSON.stringify(obra));
    Object.assign(copia, { id: A.nuevoId(), creada: A.hoy(), actualizada: A.hoy(), estado: 'Borrador', nombre: `${nombreObra(obra)} (copia)` });
    copia.presupuesto.numero = datos.siguienteNumero++;
    copia.presupuesto.fecha = A.hoy();
    copia.presupuesto.congelado = null;
    datos.obras.push(copia);
    A.guardar(datos);
    ir(`#/obra/${copia.id}/cliente`);
  });
  confirmarConSegundoToque($('borrar-obra'), () => {
    datos.obras = datos.obras.filter(o => o !== obra);
    A.guardar(datos);
    ir('#/');
  });

  // ---------- Diseño ----------
  function armarFuente() {
    document.querySelector(`input[name=fuente][value=${obra.fuente.tipo}]`).checked = true;
    $('presion').value = obra.fuente.bar;
    $('aspiracion').value = obra.fuente.aspiracion;
    obra.fuente.linea = opciones($('bomba-linea'), C.lineas.map(l => [l.linea, `${l.linea} · ${l.tipo}`]), obra.fuente.linea);
    armarModelos();
    $('accesorios').value = obra.accesorios;
    $('fuente-presion').hidden = obra.fuente.tipo !== 'presion';
    $('fuente-bomba').hidden = obra.fuente.tipo !== 'bomba';
  }
  function armarModelos() {
    const L = C.lineas.find(l => l.linea === obra.fuente.linea);
    $('bomba-uso').textContent = `Para: ${L.uso}.` + (L.origen === 'curva' ? ' Curva leída del gráfico (aproximada).' : '');
    obra.fuente.modelo = opciones($('bomba-modelo'),
      L.modelos.map(m => [m.modelo, `${m.modelo} · ${fmt(m.hp, m.hp % 1 ? 2 : 0)} HP · ${m.tension}`]), obra.fuente.modelo);
  }
  function pintarDiseno() {
    guardar();
    const calculos = obra.sectores.map(calcular);
    $('lista-sectores').innerHTML = obra.sectores.map((s, i) => {
      const c = calculos[i], nivel = peorNivel(c);
      const info = c.error ? escapar(c.error)
        : `${fmt(c.r.caudalTotal, 1)} l/min · ${fmt(Math.min(...c.r.aspersores.map(a => a.presionBoquilla)), 2)} bar en el más desfavorable`;
      return `<li><a class="sector-tarjeta" href="#/obra/${obra.id}/sector/${i + 1}">
        <span class="sector-nombre">${escapar(s.nombre || `Sector ${i + 1}`)}</span>
        <span class="sector-datos">${s.aspersores.length} aspersor${s.aspersores.length === 1 ? '' : 'es'} · ${info}</span>
        <span class="estado ${nivel}">${ESTADO_SECTOR[nivel]}</span>
      </a></li>`;
    }).join('');

    const validos = calculos.map((c, i) => ({ c, s: obra.sectores[i] })).filter(x => !x.c.error);
    if (!validos.length) { $('resumen-obra').innerHTML = '<p class="ayuda">Cargá al menos un sector para ver el resumen.</p>'; return; }
    const mayor = validos.reduce((m, x) => x.c.r.caudalTotal > m.c.r.caudalTotal ? x : m);
    const conProblemas = validos.filter(x => peorNivel(x.c) === 'error').map(x => x.s.nombre);
    const conAvisos = validos.filter(x => peorNivel(x.c) === 'aviso').map(x => x.s.nombre);
    const total = validos.reduce((t, x) => t + x.c.r.aspersores.length, 0);
    const fuente = obra.fuente.tipo === 'bomba'
      ? `la bomba ${obra.fuente.modelo} da ${fmt(mayor.c.r.fuente.presion, 2)} bar con ese caudal`
      : `la red tiene que dar ${fmt(mayor.c.r.caudalTotal, 1)} l/min a ${fmt(obra.fuente.bar, 1)} bar`;
    $('resumen-obra').innerHTML = `
      <div class="cifras">
        <div class="cifra"><b>${obra.sectores.length}</b><span>sector${obra.sectores.length === 1 ? '' : 'es'} · ${total} aspersores</span></div>
        <div class="cifra"><b>${fmt(mayor.c.r.caudalTotal, 1)}</b><span>l/min del sector que más pide</span></div>
      </div>
      <p class="resumen-texto">El que más caudal pide es <b>${escapar(mayor.s.nombre)}</b>: ${fuente}. Como los sectores riegan de a uno, ese es el que define si la fuente alcanza.</p>
      ${conProblemas.length ? `<ul class="avisos"><li class="error">Con problemas: ${conProblemas.map(escapar).join(', ')}.</li></ul>` : ''}
      ${conAvisos.length ? `<ul class="avisos"><li class="aviso">Para revisar: ${conAvisos.map(escapar).join(', ')}.</li></ul>` : ''}
      ${!conProblemas.length && !conAvisos.length ? '<p class="todo-bien">Todos los sectores están bien.</p>' : ''}`;
  }
  $('agregar-sector').addEventListener('click', () => {
    obra.sectores.push(A.sectorNuevo(obra.sectores.length + 1));
    guardar();
    ir(`#/obra/${obra.id}/sector/${obra.sectores.length}`);
  });
  const enlacesFuente = {
    presion: v => obra.fuente.bar = decimal(v),
    aspiracion: v => obra.fuente.aspiracion = decimal(v),
    'bomba-linea': v => { obra.fuente.linea = v; obra.fuente.modelo = null; armarModelos(); },
    'bomba-modelo': v => obra.fuente.modelo = v,
    accesorios: v => obra.accesorios = decimal(v),
  };
  for (const [id, fn] of Object.entries(enlacesFuente)) $(id).addEventListener('input', ev => { fn(ev.target.value); pintarDiseno(); });
  document.querySelectorAll('input[name=fuente]').forEach(r => r.addEventListener('change', ev => {
    obra.fuente.tipo = ev.target.value;
    $('fuente-presion').hidden = obra.fuente.tipo !== 'presion';
    $('fuente-bomba').hidden = obra.fuente.tipo !== 'bomba';
    pintarDiseno();
  }));

  // =====================================================================
  // Sector
  // =====================================================================
  const sector = () => obra.sectores[nSector];
  function abrirSector(i) {
    nSector = i;
    mostrar('sector');
    const s = sector();
    subtitulo(`${nombreObra(obra)} · ${s.nombre || `Sector ${i + 1}`}`);
    $('volver-obra').href = $('volver-obra-abajo').href = `#/obra/${obra.id}/diseno`;
    $('sector-nombre').value = s.nombre;
    $('sector-superficie').value = s.superficie || '';
    s.alimentacion.material = opciones($('alim-material'), materiales, s.alimentacion.material);
    s.alimentacion.nominal = Number(opciones($('alim-nominal'), diametros(s.alimentacion.material), s.alimentacion.nominal));
    sincronizarDistancias();
    $('alim-largo').value = s.alimentacion.largo;
    $('alim-largo').disabled = usaPlano();
    $('alim-desnivel').value = s.alimentacion.desnivel;
    $('valvula').checked = s.valvula;
    s.lateral.material = opciones($('lat-material'), materiales, s.lateral.material);
    s.lateral.nominal = Number(opciones($('lat-nominal'), diametros(s.lateral.material), s.lateral.nominal));
    $('borrar-sector').hidden = obra.sectores.length === 1;
    armarAspersores();
    pintarSector();
  }
  $('sector-nombre').addEventListener('input', ev => {
    sector().nombre = ev.target.value;
    subtitulo(`${nombreObra(obra)} · ${ev.target.value || `Sector ${nSector + 1}`}`);
    guardar();
  });
  $('sector-superficie').addEventListener('input', ev => { sector().superficie = decimal(ev.target.value); pintarSector(); });
  $('copiar-sector').addEventListener('click', () => {
    const copia = JSON.parse(JSON.stringify(sector()));
    copia.nombre = `${sector().nombre} (copia)`;
    obra.sectores.splice(nSector + 1, 0, copia);
    guardar();
    ir(`#/obra/${obra.id}/sector/${nSector + 2}`);
  });
  confirmarConSegundoToque($('borrar-sector'), () => {
    if (obra.sectores.length === 1) return;
    obra.sectores.splice(nSector, 1);
    guardar();
    ir(`#/obra/${obra.id}/diseno`);
  });
  const enlacesSector = {
    'alim-material': v => { sector().alimentacion.material = v; sector().alimentacion.nominal = Number(opciones($('alim-nominal'), diametros(v), sector().alimentacion.nominal)); },
    'alim-nominal': v => sector().alimentacion.nominal = Number(v),
    'alim-largo': v => sector().alimentacion.largo = decimal(v),
    'alim-desnivel': v => sector().alimentacion.desnivel = decimal(v),
    'lat-material': v => { sector().lateral.material = v; sector().lateral.nominal = Number(opciones($('lat-nominal'), diametros(v), sector().lateral.nominal)); },
    'lat-nominal': v => sector().lateral.nominal = Number(v),
  };
  for (const [id, fn] of Object.entries(enlacesSector)) $(id).addEventListener('input', ev => { fn(ev.target.value); pintarSector(); });
  $('valvula').addEventListener('change', ev => { sector().valvula = ev.target.checked; pintarSector(); });

  // ---------- Aspersores ----------
  const lista = $('aspersores');
  const plantilla = $('plantilla-aspersor');
  function armarAspersores() {
    lista.innerHTML = '';
    sector().aspersores.forEach((a, i) => {
      const li = plantilla.content.firstElementChild.cloneNode(true);
      li.dataset.i = i;
      lista.appendChild(li);
      completarAspersor(li, a, i);
    });
  }
  function completarAspersor(li, a, i) {
    const campo = n => li.querySelector(`[data-campo=${n}]`);
    a.tipo = opciones(campo('tipo'), TIPOS.map(t => [t, t]), a.tipo);
    a.boquilla = opciones(campo('boquilla'), boquillas(a.tipo).map(b => [b, etiquetaBoquilla(a.tipo, b)]), a.boquilla);
    const libre = arcoLibre(a);
    const listaArcos = libre ? [] : arcos(a.tipo, a.boquilla);
    li.querySelector('[data-solo=arco]').hidden = !listaArcos.length;
    li.querySelector('[data-solo=arco-libre]').hidden = !libre;
    if (libre) {
      a.arco = Math.min(360, Math.max(1, Math.round(Number(a.arco) || (esAjustable(a) ? 180 : 360))));
      campo('arcoLibre').value = a.arco;
    } else {
      a.arco = listaArcos.length ? Number(opciones(campo('arco'), listaArcos.map(x => [x, `${x}°`]), a.arco)) : null;
    }
    const e = R.emisor(idEmisor(a));
    const conCuerpo = e.cuerpo === 'Pro-Spray';
    li.querySelector('[data-solo=regulador]').hidden = !conCuerpo;
    if (!conCuerpo) a.regulador = '';
    campo('regulador').value = a.regulador || '';
    campo('distancia').value = a.distancia;
    campo('distancia').disabled = usaPlano();
    campo('altura').value = a.altura;
    li.querySelector('.numero').textContent = i + 1;
    li.querySelector('[data-texto=distancia]').textContent = (i ? 'Distancia al anterior' : 'Distancia a la válvula') + (usaPlano() ? ' (del plano)' : '');
    li.querySelector('.resumen').textContent = `${e.tipo} ${e.nombre}${a.tipo === 'Turbina PGP Ultra' ? ` a ${a.arco}°` : ''}`;
  }
  lista.addEventListener('input', ev => {
    const li = ev.target.closest('.aspersor');
    const n = ev.target.dataset.campo;
    if (!li || !n) return;
    const i = Number(li.dataset.i), a = sector().aspersores[i];
    if (n === 'distancia' || n === 'altura') a[n] = decimal(ev.target.value);
    else if (n === 'arcoLibre') {
      const v = decimal(ev.target.value);
      if (v < 1 || v > 360) return;
      a.arco = Math.round(v);
    } else a[n] = ev.target.value;
    if (n === 'tipo') { a.boquilla = null; a.arco = null; }
    if (n === 'arco') a.arco = Number(a.arco);
    if (['tipo', 'boquilla', 'arco', 'regulador', 'arcoLibre'].includes(n)) completarAspersor(li, a, i);
    pintarSector();
  });
  lista.addEventListener('click', ev => {
    const accion = ev.target.dataset.accion;
    if (!accion) return;
    const i = Number(ev.target.closest('.aspersor').dataset.i);
    const asps = sector().aspersores;
    if (accion === 'copiar') asps.splice(i + 1, 0, desplazado(asps[i]));
    if (accion === 'borrar') { if (asps.length === 1) return; asps.splice(i, 1); }
    sincronizarDistancias();
    armarAspersores();
    pintarSector();
  });
  // Copia de un aspersor corrida en el plano (si no, quedaría encima del original y a distancia 0).
  function desplazado(a) {
    const b = { ...a };
    if (a.x != null) b.x = r1(Math.min(obra.plano.ancho, a.x + Math.max(1, a.distancia || 3)));
    return b;
  }
  $('agregar').addEventListener('click', () => {
    const asps = sector().aspersores;
    asps.push(desplazado(asps.at(-1)));
    sincronizarDistancias();
    armarAspersores();
    pintarSector();
    lista.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  function pintarSector() {
    guardar();
    const caja = $('resultado');
    const c = calcular(sector());
    if (c.error) { caja.innerHTML = `<ul class="avisos"><li class="error">${escapar(c.error)}</li></ul>`; return; }
    const { r, rec } = c;
    const estimada = P.superficieEstimada(r, sector().aspersores);
    $('superficie-ayuda').textContent = sector().superficie
      ? `Según los aspersores serían unos ${fmt(estimada, 0)} m².`
      : `Si la dejás vacía se usan unos ${fmt(estimada, 0)} m², estimados con el alcance de los aspersores.`;
    const lpm = r.caudalTotal;
    const pMin = Math.min(...r.aspersores.map(a => a.presionBoquilla));
    const avisos = r.avisos.length
      ? `<ul class="avisos">${r.avisos.map(a => `<li class="${a.nivel}">${escapar(a.texto)}</li>`).join('')}</ul>`
      : '<p class="todo-bien">Todo en orden: presiones dentro de las tablas, velocidades y variación de presión dentro de lo recomendado.</p>';
    const recorrido = [];
    if (r.fuente.bomba) recorrido.push(`Bomba ${r.fuente.bomba.modelo}: ${fmt(r.fuente.bomba.altura, 1)} m a ${fmt(lpm, 1)} l/min → <b>${fmt(r.fuente.presion, 2)} bar</b> a la salida${obra.fuente.aspiracion ? ` (descontando ${fmt(obra.fuente.aspiracion, 1)} m de aspiración)` : ''}`);
    else recorrido.push(`Fuente: <b>${fmt(r.fuente.presion, 2)} bar</b>`);
    if (r.alimentacion) recorrido.push(`Caño hasta la válvula (${r.alimentacion.cano}, ${fmt(r.alimentacion.largo, 0)} m): pierde ${fmt(r.alimentacion.perdida, 2)} bar, el agua va a ${fmt(r.alimentacion.velocidad, 2)} m/s`);
    recorrido.push(`Llega a la válvula con <b>${fmt(r.presionValvula, 2)} bar</b>`);
    if (sector().valvula) recorrido.push(`La PGV de 1" pierde ${fmt(r.perdidaValvula, 2)} bar → sale con <b>${fmt(r.presionSalidaValvula, 2)} bar</b>`);
    const hayReg = r.aspersores.some(a => a.regulador);
    const filasAsp = r.aspersores.map((a, i) => `<tr>
      <td class="nombre">${a.n}. ${escapar(a.emisor.nombre)}${a.regulador ? ' · ' + a.regulador : ''}</td>
      ${hayReg ? `<td>${fmt(a.presionEntrada, 2)}</td>` : ''}
      <td class="${a.fuera < 0 ? 'mal' : ''}">${fmt(a.presionBoquilla, 2)}</td>
      <td>${fmt(a.caudal, 2)}</td><td>${fmt(a.radio, 1)}</td>
      <td class="${r.tramos[i].velocidad > R.VELOCIDAD_MAX ? 'mal' : ''}">${fmt(r.tramos[i].velocidad, 2)}</td></tr>`).join('');
    const filasDiam = rec.opciones.map(o => `<tr class="${o.nominal === rec.recomendado ? 'elegido' : ''}">
      <td>${o.nominal} mm</td><td>${fmt(o.caudal, 1)}</td>
      <td class="${o.velocidadMax > R.VELOCIDAD_MAX ? 'mal' : ''}">${fmt(o.velocidadMax, 2)}</td>
      <td class="${o.variacion > R.VARIACION_MAX ? 'mal' : ''}">${fmt(o.variacion, 0)} %</td>
      <td>${o.cumple ? 'Sí' : 'No'}</td></tr>`).join('');
    caja.innerHTML = `
      <div class="cifras">
        <div class="cifra"><b>${fmt(lpm, 1)}</b><span>l/min del sector</span></div>
        <div class="cifra"><b>${fmt(pMin, 2)}</b><span>bar en el aspersor más desfavorable</span></div>
        <div class="cifra"><b>${rec.recomendado ? rec.recomendado + ' mm' : '—'}</b><span>${rec.recomendado ? 'caño del sector recomendado'
          : rec.opciones.every(o => o.bajos > 0) ? 'ningún caño alcanza: falta presión en la fuente' : 'ningún caño cumple: ver la tabla de abajo'}</span></div>
      </div>
      ${avisos}
      <h3>Recorrido del agua</h3>
      <ul class="recorrido">${recorrido.map(t => `<li>${t}</li>`).join('')}</ul>
      <h3>Aspersores · variación de presión ${fmt(r.variacion, 0)} %</h3>
      <div class="tabla"><table>
        <thead><tr><th>Aspersor</th>${hayReg ? '<th>Entra<br>bar</th>' : ''}<th>Boquilla<br>bar</th><th>l/min</th><th>Alcance<br>m</th><th>Vel.<br>m/s</th></tr></thead>
        <tbody>${filasAsp}</tbody></table></div>
      <h3>Caño del sector: ${R.CANOS[sector().lateral.material].detalle}</h3>
      <div class="tabla"><table>
        <thead><tr><th>Diámetro</th><th>l/min</th><th>Vel. máx.<br>m/s</th><th>Variación<br>presión</th><th>Cumple</th></tr></thead>
        <tbody>${filasDiam}</tbody></table></div>
      <p class="ayuda">Cumple = el agua no pasa de ${fmt(R.VELOCIDAD_MAX, 1)} m/s, la presión no varía más del ${R.VARIACION_MAX} % y ningún aspersor queda por debajo de su tabla.
      Caudales del catálogo Hunter 2026; donde el catálogo da dos caudales distintos para la misma boquilla se usa el mayor.</p>`;
  }

  // =====================================================================
  // Presupuesto
  // =====================================================================
  function pintarPresupuesto() {
    const p = obra.presupuesto;
    const pre = presupuestoDe(obra);
    const fijo = cerrado();
    $('presupuesto-titulo').textContent = `Presupuesto N° ${PDF.numeroTexto(p.numero)}`;
    $('presupuesto-cerrado').hidden = !fijo;
    if (fijo) $('presupuesto-cerrado').innerHTML = `<b>Presupuesto cerrado</b> el ${escapar(p.congelado.fechaCierre || '')} (${escapar(obra.estado)}).
      Los cambios del diseño y de la lista de precios ya no lo modifican. <button id="reabrir" class="chico" type="button">Reabrir para editar</button>`;
    for (const [id, v] of [['pre-fecha', p.fecha], ['pre-validez', p.validez], ['pre-descuento', p.descuento], ['pre-desperdicio', p.desperdicio], ['pre-pago', p.formaPago], ['pre-notas', p.notas]]) {
      $(id).value = v ?? '';
      $(id).disabled = fijo;
    }
    $('pre-iva').checked = !!p.iva;
    $('pre-iva').disabled = fijo;
    $('agregar-renglon').hidden = fijo;
    pintarRenglones(pre, fijo);
    pintarTotales(pre);
  }

  function pintarRenglones(pre, fijo) {
    const dis = fijo ? 'disabled' : '';
    let html = '';
    for (const rubro of P.RUBROS) {
      const rs = pre.renglones.filter(r => r.rubro === rubro);
      if (!rs.length) continue;
      html += `<h3 class="rubro">${rubro}</h3>`;
      for (const r of rs) {
        const ref = r.auto ? `data-clave="${escapar(r.clave)}"` : `data-propio="${escapar(r.id)}"`;
        const cambiada = r.auto && r.cantidad !== r.cantidadCalculada;
        html += `<div class="renglon ${r.precio ? '' : 'sin-precio'}" ${ref}>
          <div class="renglon-fila">
            <input type="text" data-r="descripcion" value="${escapar(r.descripcion)}" ${dis} aria-label="Descripción">
            ${fijo ? '' : '<button type="button" class="quitar" data-r="quitar" aria-label="Quitar renglón">×</button>'}
          </div>
          <div class="renglon-numeros">
            <label>Cant. <span class="unidad">${escapar(r.unidad)}</span><input type="number" inputmode="decimal" step="any" min="0" data-r="cantidad" value="${r.cantidad}" ${dis}></label>
            <label>Precio unit. <span class="unidad">$</span><input type="number" inputmode="decimal" step="any" min="0" data-r="precio" value="${r.precio || ''}" placeholder="sin precio" ${dis}></label>
            <div class="importe"><span class="unidad">Importe</span><b data-importe>${P.pesos(r.importe)}</b></div>
          </div>
          ${cambiada && !fijo ? `<p class="ayuda">Calculado del diseño: ${fmt(r.cantidadCalculada, 0)} ${escapar(r.unidad)}. <button type="button" class="enlace" data-r="recalcular">Volver al calculado</button></p>` : ''}
          ${r.clave === 'mo-m2' && pre.datos.m2Estimados && !fijo ? '<p class="ayuda">Hay sectores sin superficie cargada: se estimó con el alcance de los aspersores.</p>' : ''}
        </div>`;
      }
    }
    $('renglones').innerHTML = html || '<p class="ayuda">Cargá aspersores en el diseño para que aparezcan los materiales.</p>';
    $('quitados').innerHTML = !fijo && pre.quitados.length
      ? `<p class="ayuda">Quitados: ${pre.quitados.map(r => `${escapar(r.descripcion)} <button type="button" class="enlace" data-reponer="${escapar(r.clave)}">volver a agregar</button>`).join(' · ')}</p>` : '';
  }

  function pintarTotales(pre) {
    const filas = P.RUBROS.filter(rb => pre.subtotales[rb]).map(rb => `<tr><td>${rb}</td><td>${P.pesos(pre.subtotales[rb])}</td></tr>`);
    if (pre.descuento) filas.push(`<tr><td>Descuento ${fmt(obra.presupuesto.descuento, 0)} %</td><td>− ${P.pesos(pre.descuento)}</td></tr>`);
    if (pre.iva) filas.push(`<tr><td>IVA ${P.IVA} %</td><td>${P.pesos(pre.iva)}</td></tr>`);
    $('totales').innerHTML = `<table class="totales">${filas.join('')}<tr class="total-final"><td>Total</td><td>${P.pesos(pre.total)}</td></tr></table>
      ${pre.sinPrecio ? `<ul class="avisos"><li class="aviso">${pre.sinPrecio} renglón${pre.sinPrecio === 1 ? '' : 'es'} sin precio: no sale${pre.sinPrecio === 1 ? '' : 'n'} en el PDF hasta que le pongas uno.</li></ul>` : ''}`;
  }

  // Cambios en los renglones: mientras escribe se recalculan importe y total sin rearmar la lista (no pierde el foco).
  $('renglones').addEventListener('input', ev => {
    const campo = ev.target.dataset.r;
    const fila = ev.target.closest('.renglon');
    if (!campo || !fila || cerrado()) return;
    const p = obra.presupuesto;
    if (fila.dataset.clave) {
      const clave = fila.dataset.clave;
      if (campo === 'precio') datos.precios[clave] = decimal(ev.target.value);
      else { p.cambios[clave] ||= {}; p.cambios[clave][campo] = campo === 'cantidad' ? decimal(ev.target.value) : ev.target.value; }
    } else {
      const r = p.propios.find(x => x.id === fila.dataset.propio);
      r[campo] = campo === 'descripcion' ? ev.target.value : (campo === 'precio' ? decimal(ev.target.value) : decimal(ev.target.value));
    }
    guardar();
    const pre = presupuestoDe(obra);
    const r = pre.renglones.find(x => fila.dataset.clave ? x.clave === fila.dataset.clave : x.id === fila.dataset.propio);
    if (r) { fila.querySelector('[data-importe]').textContent = P.pesos(r.importe); fila.classList.toggle('sin-precio', !r.precio); }
    pintarTotales(pre);
  });
  $('renglones').addEventListener('change', ev => { if (ev.target.dataset.r === 'cantidad') pintarPresupuesto(); });
  $('renglones').addEventListener('click', ev => {
    const accion = ev.target.dataset.r;
    const fila = ev.target.closest('.renglon');
    if (!fila || cerrado() || !['quitar', 'recalcular'].includes(accion)) return;
    const p = obra.presupuesto;
    if (fila.dataset.clave) {
      p.cambios[fila.dataset.clave] ||= {};
      if (accion === 'quitar') p.cambios[fila.dataset.clave].quitar = true;
      else delete p.cambios[fila.dataset.clave].cantidad;
    } else p.propios = p.propios.filter(x => x.id !== fila.dataset.propio);
    guardar(); pintarPresupuesto();
  });
  $('quitados').addEventListener('click', ev => {
    const clave = ev.target.dataset.reponer;
    if (!clave) return;
    delete obra.presupuesto.cambios[clave].quitar;
    guardar(); pintarPresupuesto();
  });
  $('agregar-renglon').addEventListener('click', () => {
    obra.presupuesto.propios.push({ id: A.nuevoId(), rubro: 'Otros', descripcion: '', unidad: 'gl', cantidad: 1, precio: 0 });
    guardar(); pintarPresupuesto();
    const ultimo = [...document.querySelectorAll('#renglones .renglon[data-propio]')].at(-1);
    ultimo?.querySelector('input').focus();
  });
  $('panel-presupuesto').addEventListener('click', ev => {
    if (ev.target.id !== 'reabrir') return;
    obra.presupuesto.congelado = null;
    obra.estado = 'Borrador';
    guardar(); pintarPresupuesto();
  });
  const enlacesPre = {
    'pre-fecha': v => obra.presupuesto.fecha = v,
    'pre-validez': v => obra.presupuesto.validez = decimal(v),
    'pre-descuento': v => obra.presupuesto.descuento = Math.min(100, decimal(v)),
    'pre-desperdicio': v => obra.presupuesto.desperdicio = decimal(v),
    'pre-pago': v => obra.presupuesto.formaPago = v,
    'pre-notas': v => obra.presupuesto.notas = v,
  };
  for (const [id, fn] of Object.entries(enlacesPre)) $(id).addEventListener('input', ev => {
    fn(ev.target.value); guardar();
    if (id === 'pre-desperdicio') pintarPresupuesto(); else pintarTotales(presupuestoDe(obra));
  });
  $('pre-iva').addEventListener('change', ev => { obra.presupuesto.iva = ev.target.checked; guardar(); pintarTotales(presupuestoDe(obra)); });

  // ---------- PDF y envío ----------
  async function hacerPDF() {
    const pre = presupuestoDe(obra);
    const blob = await PDF.armarPDF(obra, pre, datos.instalador);
    return new File([blob], PDF.nombreArchivo(obra), { type: 'application/pdf' });
  }
  $('ver-pdf').addEventListener('click', async ev => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = 'Armando PDF…';
    try {
      const archivo = await hacerPDF();
      const url = URL.createObjectURL(archivo);
      const w = window.open(url, '_blank');
      if (!w) descargar(archivo);
    } finally { b.disabled = false; b.textContent = 'Ver PDF'; }
  });
  $('enviar-pdf').addEventListener('click', async ev => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = 'Armando PDF…';
    try {
      const archivo = await hacerPDF();
      const saludo = obra.cliente.nombre ? `Hola ${obra.cliente.nombre.split(' ')[0]}, ` : 'Hola, ';
      const texto = `${saludo}te paso el presupuesto del sistema de riego. Cualquier consulta, avisame.`;
      if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
        try {
          await navigator.share({ files: [archivo], title: archivo.name, text: texto });
          if (obra.estado === 'Borrador') { cambiarEstado('Enviado'); pintarPresupuesto(); }
        } catch (err) { if (err.name !== 'AbortError') descargar(archivo); }
      } else descargar(archivo);
    } finally { b.disabled = false; b.textContent = 'Enviar al cliente'; }
  });
  function descargar(archivo) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(archivo);
    a.download = archivo.name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  // =====================================================================
  // Lista de precios
  // =====================================================================
  const GRUPOS = [
    ['Mano de obra', c => c.startsWith('mo-')],
    ['Cuerpos y turbinas', c => c.startsWith('cuerpo-') || c.startsWith('turbina-')],
    ['Boquillas', c => c.startsWith('boq-')],
    ['Caños', c => c.startsWith('cano-')],
    ['Válvulas, caja y programador', c => /^(valvula|caja|programador)/.test(c)],
    ['Bombas', c => c.startsWith('bomba-')],
    ['Conexiones', c => true],
  ];
  function pintarPrecios() {
    // Materiales que aparecen en las obras, más la mano de obra por m² aunque no haya obras.
    const items = new Map([['mo-m2', { descripcion: 'Mano de obra de instalación del riego', unidad: 'm²' }]]);
    for (const o of datos.obras) {
      try { for (const r of P.materialesDeObra(o, sectorParaCalcular(o)).renglones) items.set(r.clave, { descripcion: r.descripcion, unidad: r.unidad }); } catch { /* obra con error */ }
    }
    let html = '';
    const usados = new Set();
    for (const [grupo, cumple] of GRUPOS) {
      const claves = [...items.keys()].filter(c => !usados.has(c) && cumple(c)).sort();
      if (!claves.length) continue;
      claves.forEach(c => usados.add(c));
      html += `<h3 class="rubro">${grupo}</h3>` + claves.map(c => {
        const it = items.get(c);
        return `<label class="precio-item">${escapar(it.descripcion)} <span class="unidad">$ por ${escapar(it.unidad)}</span>
          <input type="number" inputmode="decimal" min="0" step="any" data-precio="${escapar(c)}" value="${datos.precios[c] || ''}" placeholder="sin precio"></label>`;
      }).join('');
    }
    $('lista-precios').innerHTML = html;
  }
  $('lista-precios').addEventListener('input', ev => {
    const c = ev.target.dataset.precio;
    if (!c) return;
    datos.precios[c] = decimal(ev.target.value);
    guardar();
  });

  // =====================================================================
  // Mis datos
  // =====================================================================
  function pintarDatos() {
    document.querySelectorAll('[data-instalador]').forEach(i => i.value = datos.instalador[i.dataset.instalador] || '');
  }
  document.querySelectorAll('[data-instalador]').forEach(i => i.addEventListener('input', () => {
    datos.instalador[i.dataset.instalador] = i.value; guardar();
  }));

  // =====================================================================
  // Copia de seguridad
  // =====================================================================
  function pintarCopia() {
    $('copia-info').textContent = datos.ultimaCopia
      ? `Última copia guardada: ${datos.ultimaCopia}. Tenés ${datos.obras.length} obra${datos.obras.length === 1 ? '' : 's'}.`
      : `Todavía no guardaste ninguna copia. Tenés ${datos.obras.length} obra${datos.obras.length === 1 ? '' : 's'}.`;
  }
  $('exportar').addEventListener('click', async () => {
    datos.ultimaCopia = A.hoy();
    A.guardar(datos);
    const archivo = new File([A.exportar(datos)], `Aspersia copia ${A.hoy()}.json`, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
      try { await navigator.share({ files: [archivo], title: archivo.name }); } catch (err) { if (err.name !== 'AbortError') descargar(archivo); }
    } else descargar(archivo);
    pintarCopia();
  });
  $('importar').addEventListener('change', async ev => {
    const archivo = ev.target.files[0];
    if (!archivo) return;
    try {
      const nuevos = A.importar(await archivo.text());
      localStorage.setItem('aspersia.datos.v3.antes-de-recuperar', JSON.stringify(datos));
      for (const k of Object.keys(datos)) delete datos[k];
      Object.assign(datos, nuevos);
      A.guardar(datos);
      $('importar-resultado').textContent = `Listo: se recuperaron ${datos.obras.length} obra${datos.obras.length === 1 ? '' : 's'}. Lo que había antes quedó guardado aparte por si hace falta.`;
    } catch (err) {
      $('importar-resultado').textContent = err.message.startsWith('El archivo') ? err.message : 'No se pudo leer el archivo. Elegí una copia de Aspersia (.json).';
    }
    ev.target.value = '';
    pintarCopia();
  });

  // ---------- Arranque ----------
  if (!location.hash) history.replaceState(null, '', '#/');
  rutear();
})();
