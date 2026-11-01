// Pantallas de Aspersia. Navegación por la dirección (#/...), así el botón atrás del teléfono funciona:
//   #/                         obras
//   #/obra/<id>/<pestaña>      cliente | diseno | presupuesto
//   #/obra/<id>/sector/<n>     un sector de la obra
//   #/precios  #/datos  #/copia
// Usa RIEGO (cálculo), PRESUPUESTO (materiales y totales), ALMACEN (guardado) y PDF.

(async function () {
  const R = window.RIEGO, P = window.PRESUPUESTO, A = window.ALMACEN, C = window.CZERWENY;
  const $ = id => document.getElementById(id);
  const fmt = R.fmt;
  // Qué teléfono es: cambia dónde se guarda la copia (iCloud en el iPhone, Google Drive en Android) y algunos textos.
  // Chrome en el iPhone también es iPhone (usa el mismo motor que Safari).
  const EQUIPO = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iphone'
    : /Android/.test(navigator.userAgent) ? 'android' : 'otro';
  const NUBE = { iphone: 'iCloud', android: 'Google Drive', otro: 'la nube' }[EQUIPO];
  document.querySelectorAll('[data-equipo]').forEach(e => { e.hidden = e.dataset.equipo !== EQUIPO; });
  document.querySelectorAll('[data-nube]').forEach(b => { b.textContent = EQUIPO === 'otro' ? 'Guardar copia (descargar archivo)' : `Guardar copia en ${NUBE}`; });
  document.querySelectorAll('[data-nube-nombre]').forEach(e => { e.textContent = EQUIPO === 'otro' ? 'tu computadora' : NUBE; });

  const datos = await A.abrir();
  datos.costos ||= {};
  window.PRESUPUESTO_COSTOS = datos.costos;   // lista de costos (para la ganancia del presupuesto)
  let obra = null;          // obra abierta
  let nSector = null;       // índice del sector abierto
  let pendiente = null;
  // Guarda enseguida y marca la obra como modificada.
  const guardar = () => {
    if (obra) obra.actualizada = A.hoy();
    datos.cambiosSinCopia ||= A.hoy();   // desde cuándo hay cambios que no están en ninguna copia
    clearTimeout(pendiente);
    pendiente = setTimeout(async () => { if (!await A.guardar(datos)) avisarSinLugar(); }, 150);
  };
  // El teléfono le da a cada app web unos 5 MB: con muchas fotos de fondo se puede llenar.
  function avisarSinLugar() {
    if (document.querySelector('.aviso-flotante')) return;
    const d = document.createElement('div');
    d.className = 'aviso-flotante';
    d.textContent = 'No se pudo guardar en el teléfono: lo último que cambiaste no quedó guardado. Revisá que el teléfono tenga lugar libre y guardá una copia de seguridad en ' + NUBE + '.';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 12000);
  }
  // En el teléfono la app puede cerrarse sin aviso al pasar a otra: se guarda también cuando deja de verse.
  window.addEventListener('pagehide', () => A.guardar(datos));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') A.guardar(datos); });

  // ---------- Utilidades ----------
  const opciones = (sel, items, valor) => {
    sel.innerHTML = items.map(([v, t]) => `<option value="${escapar(v)}">${escapar(t)}</option>`).join('');
    if (valor != null && items.some(([v]) => String(v) === String(valor))) sel.value = valor;
    return sel.value;
  };
  // Los campos numéricos del teléfono entregan el decimal con punto ("1500.5"); se acepta también la coma.
  const decimal = v => { const x = R.leerNumero(v); return Number.isFinite(x) ? x : 0; };   // acepta 5,12 y 5.12
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
  // Qué aspersor es cada uno, qué entra al cálculo y las distancias del plano se deciden en app/obra.js.
  const O = window.OBRA;
  const { esAjustable, esMP, arcoLibre, idEmisor } = O;
  function etiquetaBoquilla(tipo, boq) {
    const e = deTipo(tipo).find(x => x.boquilla === boq);
    const r = e.radios[Math.floor(e.radios.length / 2)];
    const nombre = e.tipo.startsWith('Turbina PGP Ultra') && e.arco == null ? e.nombre : boq;
    return `${nombre} · alcance ${fmt(r, 1)} m`;
  }

  // ---------- Cálculo ----------
  const sectorParaCalcular = O.paraCalcular;
  const calcular = s => O.calcular(obra, s);
  const presupuestoDe = o => O.presupuesto(o, datos.precios);
  const peorNivel = c => c.error ? 'error' : ['error', 'aviso', 'info'].find(n => c.r.avisos.some(a => a.nivel === n)) || 'bien';
  const ESTADO_SECTOR = { error: 'Hay problemas', aviso: 'Revisar avisos', info: 'Bien, con notas', bien: 'Todo bien' };
  const CLASE_ESTADO = { Borrador: 'info', Enviado: 'aviso', Aceptado: 'bien', Terminado: 'bien', Rechazado: 'error' };

  // =====================================================================
  // Navegación
  // =====================================================================
  const VISTAS = ['inicio', 'obra', 'sector', 'precios', 'datos', 'copia', 'caja', 'clientes'];
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
      // Mantenimiento: sin diseño ni plano
      const mant = obra.tipo === 'mantenimiento';
      if (mant && ['sector', 'diseno', 'plano'].includes(sub)) return ir(`#/obra/${obra.id}/presupuesto`);
      if (sub === 'sector') {
        const i = Number(n) - 1;
        if (!(i >= 0 && i < obra.sectores.length)) return ir(`#/obra/${obra.id}/diseno`);
        return abrirSector(i);
      }
      return abrirObra(['cliente', 'plano', 'diseno', 'presupuesto', 'cobros'].includes(sub) ? sub : mant ? 'presupuesto' : 'plano');   // primero el plano, después el diseño
    }
    obra = null;
    if (seccion === 'precios') { mostrar('precios'); subtitulo('Lista de precios'); return pintarPrecios(); }
    if (seccion === 'datos') { mostrar('datos'); subtitulo('Mis datos'); return pintarDatos(); }
    if (seccion === 'copia') { mostrar('copia'); subtitulo('Copia de seguridad'); return pintarCopia(); }
    if (seccion === 'clientes') { mostrar('clientes'); subtitulo('Clientes'); return pintarClientes(); }
    if (seccion === 'caja') { mostrar('caja'); subtitulo('Caja'); return pintarCaja(); }
    mostrar('inicio'); subtitulo('Riegos Tecnológicos'); pintarInicio(); pintarRecordatorio();
    // Versión guardada en el teléfono (para saber si ya se actualizó)
    window.caches?.keys().then(k => { const v = k.find(n => n.startsWith('aspersia-v')); $('version-app').textContent = v ? `Versión ${v.replace('aspersia-v', '')}` : ''; }).catch(() => {});
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
      const mant = o.tipo === 'mantenimiento';
      const caja = O.cajaDeObra(o, datos.precios);
      const cobrado = caja.cobrado ? ` · cobrado ${P.pesos(caja.cobrado)}` : '';
      return `<li><a class="sector-tarjeta" href="#/obra/${o.id}/${mant ? 'presupuesto' : 'plano'}">
        <span class="sector-nombre">${escapar(nombreObra(o))}</span>
        <span class="sector-datos">${escapar(lugar || 'Sin datos del cliente')}</span>
        <span class="sector-datos">N° ${PDF.numeroTexto(o.presupuesto.numero)} · ${mant ? 'Mantenimiento' : `${o.sectores.length} sector${o.sectores.length === 1 ? '' : 'es'}`}${total}${cobrado}</span>
        <span class="estado ${CLASE_ESTADO[o.estado] || 'info'}">${escapar(o.estado)}</span>
      </a><button type="button" class="chico peligro borrar-obra-lista" data-borrar-obra="${o.id}">Borrar</button></li>`;
    }).join('') : '<li class="vacio"><b>Empezá tu primera obra</b><span>Cargá el cliente, diseñá los sectores y armá el presupuesto.</span></li>';
  }
  $('lista-obras').addEventListener('click', ev => {
    const b = ev.target.closest('[data-borrar-obra]');
    if (!b) return;
    if (!b.dataset.confirmar) { b.dataset.confirmar = '1'; b.textContent = 'Tocá de nuevo para borrar'; return; }
    datos.obras = datos.obras.filter(o => o.id !== b.dataset.borrarObra);
    A.guardar(datos);
    pintarInicio();
  });
  // Botón Guardar: se guarda solo igual, pero así se ve que quedó guardado
  $('guardar-obra').addEventListener('click', async () => {
    clearTimeout(pendiente);
    if (obra) obra.actualizada = A.hoy();
    const ok = await A.guardar(datos);
    const h = new Date();
    $('guardado').textContent = ok ? `Guardado ✓ ${String(h.getHours()).padStart(2, '0')}:${String(h.getMinutes()).padStart(2, '0')}` : 'No se pudo guardar';
  });
  const nuevaObra = tipo => {
    const o = A.obraNueva(datos, tipo);
    datos.obras.push(o);
    A.guardar(datos);
    ir(`#/obra/${o.id}/cliente`);
  };
  $('nueva-obra').addEventListener('click', () => nuevaObra('riego'));
  $('nuevo-mantenimiento').addEventListener('click', () => nuevaObra('mantenimiento'));

  // =====================================================================
  // Obra: pestañas Cliente, Diseño y Presupuesto
  // =====================================================================
  let pestana = 'diseno';
  function abrirObra(p) {
    pestana = p;
    nSector = null;
    $('guardado').textContent = '';
    mostrar('obra');
    subtitulo(nombreObra(obra));
    const mant = obra.tipo === 'mantenimiento';
    document.querySelectorAll('[data-pestana]').forEach(a => {
      a.href = `#/obra/${obra.id}/${a.dataset.pestana}`;
      a.setAttribute('aria-selected', a.dataset.pestana === p);
      a.hidden = mant && (a.dataset.pestana === 'diseno' || a.dataset.pestana === 'plano');
    });
    for (const panel of ['cliente', 'diseno', 'plano', 'presupuesto', 'cobros']) $(`panel-${panel}`).hidden = panel !== p;
    if (p === 'cliente') pintarCliente();
    if (p === 'diseno') { armarFuente(); pintarDiseno(); $('consulta-resultado').textContent = ''; }
    if (p === 'plano') abrirPlano();
    if (p === 'presupuesto') pintarPresupuesto();
    if (p === 'cobros') pintarCobros();
  }

  // =====================================================================
  // Plano
  // =====================================================================
  const GEO = window.GEOMETRIA;
  const r1 = v => Math.round(v * 10) / 10;
  const usaPlano = () => obra.plano && obra.plano.distanciasDesdePlano;
  const aspersoresDelPlano = () => O.aspersoresDelPlano(obra);
  const sincronizarDistancias = () => O.sincronizarDistancias(obra);

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
      degradeSol: obra.plano.verSol ? SOL.degradeSol(obra.plano, obra.plano.norte || 0) : null,
    }).catch(err => { $('plano-3d').innerHTML = `<p class="ayuda">${escapar(err.message)}</p>`; });
  }
  document.querySelectorAll('[data-modo]').forEach(b => b.addEventListener('click', () => cambiarModoPlano(b.dataset.modo)));
  $('encuadrar-3d').addEventListener('click', () => PLANO3D.encuadrar());
  $('agua-3d').addEventListener('click', ev => { const corre = PLANO3D.alternarAgua(); ev.currentTarget.style.opacity = corre ? 1 : 0.45; });
  // Al elegir otro sector en el filtro o cambiar la cobertura, el 3D se rearma con lo que se ve.
  $('plano-filtro').addEventListener('click', () => { if (modoPlano === '3d') setTimeout(abrir3D, 0); });

  function abrirPlano() {
    GEO.ubicarSinPosicion(obra.plano, obra.sectores);
    sincronizarDistancias();
    $('plano-ancho').value = obra.plano.ancho;
    $('plano-largo').value = obra.plano.largo;
    $('plano-distancias').checked = usaPlano();
    pintarSol();
    pintarFondo();
    guardar();
    PLANO.iniciar(planoActual());
    cambiarModoPlano(modoPlano);
  }

  // ---------- Foto o captura de fondo (por ejemplo, Google Maps en vista satélite) ----------
  const LADO_MAX_FONDO = 1600;   // px: se achica para que entre en el teléfono (~150 a 300 KB)

  function pintarFondo() {
    const f = obra.plano.fondo;
    $('fondo-acciones').hidden = !f;
    $('fondo-calibrar').hidden = true;
    if (!f) return;
    $('fondo-opacidad').value = f.opacidad ?? 70;
    $('fondo-estado').textContent = f.escala
      ? `Escalada con una medida real de ${fmt(f.escala.metros, 1)} m. La imagen mide ${fmt(f.ancho, 1)} × ${fmt(f.alto, 1)} m.`
      : 'Todavía sin escalar: las medidas son aproximadas. Dibujá la zona a regar y escribí cuánto mide un lado.';
  }

  async function achicarImagen(archivo) {
    const bmp = await createImageBitmap(archivo);
    const k = Math.min(1, LADO_MAX_FONDO / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return { imagen: c.toDataURL('image/jpeg', 0.75), w: c.width, h: c.height };
  }

  $('fondo-archivo').addEventListener('change', async ev => {
    const archivo = ev.target.files[0];
    ev.target.value = '';
    if (!archivo) return;
    let img;
    try { img = await achicarImagen(archivo); }
    catch { $('fondo-estado').textContent = 'No se pudo abrir esa imagen. Probá con una captura de pantalla (PNG o JPG).'; $('fondo-acciones').hidden = false; return; }
    // Mientras no se escale, la imagen ocupa el ancho del terreno actual; el terreno toma el tamaño de la imagen.
    const ancho = obra.plano.ancho, alto = Math.round(ancho * img.h / img.w * 100) / 100;
    obra.plano.fondo = { imagen: img.imagen, ancho, alto, opacidad: obra.plano.fondo?.opacidad ?? 70, escala: null };
    obra.plano.norte = 0;   // las capturas de Google Maps vienen con el norte arriba
    pintarSol();
    obra.plano.largo = alto;
    for (const s of obra.sectores) for (const p of [s.valvulaPos, ...s.aspersores]) if (p && p.y != null) p.y = Math.min(alto, p.y);
    obra.plano.fuente.y = Math.min(alto, obra.plano.fuente.y);
    $('plano-largo').value = alto;
    sincronizarDistancias(); guardar();
    pintarFondo();
    PLANO.iniciar(planoActual());
    if (modoPlano === '3d') cambiarModoPlano('2d');
    PLANO.dibujarZona();   // lo siguiente: marcar la parte que se riega y escalar con un lado
    $('plano-svg').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  function empezarEscala() {
    if (modoPlano === '3d') cambiarModoPlano('2d');
    $('fondo-calibrar').hidden = false;
    $('fondo-medida').hidden = true;
    $('fondo-paso').textContent = 'Tocá en el plano el punto A de una medida que conozcas (por ejemplo, una punta del frente del lote).';
    PLANO.calibrar(
      () => { $('fondo-paso').textContent = 'Ahora tocá el punto B, la otra punta de esa medida.'; },
      (a, b) => {
        $('fondo-paso').textContent = `Marcaste A y B: en el plano miden ${fmt(Math.hypot(b.x - a.x, b.y - a.y), 1)} m. ¿Cuánto miden en la realidad?`;
        $('fondo-medida').hidden = false;
        $('fondo-metros').value = '';
        $('fondo-metros').focus();
        puntosEscala = [a, b];
      });
    $('plano-svg').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  let puntosEscala = null;
  $('fondo-escalar').addEventListener('click', empezarEscala);
  $('fondo-cancelar').addEventListener('click', () => { PLANO.dejarDeCalibrar(); pintarFondo(); });
  $('fondo-aplicar').addEventListener('click', () => {
    const metros = decimal($('fondo-metros').value);
    let k;
    try { k = GEO.factorDeEscala(puntosEscala[0], puntosEscala[1], metros); }
    catch (err) { $('fondo-paso').textContent = err.message; return; }
    GEO.escalarPlano(obra.plano, obra.sectores, k);
    obra.plano.fondo.escala = { metros };
    $('plano-ancho').value = obra.plano.ancho;
    $('plano-largo').value = obra.plano.largo;
    sincronizarDistancias(); guardar();
    PLANO.dejarDeCalibrar();
    pintarFondo();
    PLANO.iniciar(planoActual());
  });
  $('fondo-opacidad').addEventListener('input', ev => { obra.plano.fondo.opacidad = Number(ev.target.value); guardar(); PLANO.pintar(); });
  confirmarConSegundoToque($('fondo-quitar'), () => {
    delete obra.plano.fondo;
    guardar(); pintarFondo(); PLANO.iniciar(planoActual());
  });
  const medidaTerreno = (campo, v) => {
    obra.plano[campo] = Math.max(1, Math.min(500, decimal(v)));
    // Lo que quedó afuera del terreno nuevo se trae al borde (los aspersores sin ubicar siguen sin ubicar)
    const t = obra.plano;
    const adentro = p => { if (p && p.x != null && p.y != null) { p.x = Math.min(t.ancho, p.x); p.y = Math.min(t.largo, p.y); } };
    adentro(t.fuente);
    for (const s of obra.sectores) [s.valvulaPos, ...s.aspersores, ...(s.ramal || [])].forEach(adentro);
    for (const z of t.zonas || []) z.forEach(adentro);
    sincronizarDistancias(); guardar();
    PLANO.iniciar({ ...planoActual() });
  };
  const planoActual = () => ({
    obra, svg: $('plano-svg'), botones: $('plano-botones'), seleccion: $('plano-seleccion'),
    estadisticas: $('plano-estadisticas'), filtro: $('plano-filtro'), aspersores: aspersoresDelPlano,
    leyenda: $('plano-leyenda'), rosa: $('plano-rosa'), acciones: $('plano-acciones'), flotante: $('plano-flotante'),
    // Al escalar con un lado de la zona cambia el tamaño del terreno y de la foto
    alEscalar: () => { $('plano-ancho').value = obra.plano.ancho; $('plano-largo').value = obra.plano.largo; pintarFondo(); },
    alCambiar: () => { sincronizarDistancias(); guardar(); },
  });
  $('plano-ancho').addEventListener('change', ev => medidaTerreno('ancho', ev.target.value));
  $('plano-largo').addEventListener('change', ev => medidaTerreno('largo', ev.target.value));
  $('plano-distancias').addEventListener('change', ev => { obra.plano.distanciasDesdePlano = ev.target.checked; sincronizarDistancias(); guardar(); PLANO.pintar(); });
  // Qué se pinta sobre el terreno: cobertura de agua, lado del sol, o nada.
  const capaActual = () => obra.plano.verSol ? 'sol' : obra.plano.verCobertura ? 'agua' : 'nada';
  function elegirCapa(capa) {
    obra.plano.verSol = capa === 'sol';
    obra.plano.verCobertura = capa === 'agua';
    guardar(); pintarSol();
    if (modoPlano === '3d') abrir3D(); else PLANO.pintar();
  }
  $('plano-capa').addEventListener('click', ev => { const b = ev.target.closest('[data-capa]'); if (b) elegirCapa(b.dataset.capa); });

  // ---------- Norte (para el lado del sol) ----------
  function pintarSol() {
    const p = obra.plano;
    document.querySelectorAll('#plano-capa [data-capa]').forEach(b => b.classList.toggle('activo', b.dataset.capa === capaActual()));
    $('sol-norte').value = p.norte || 0;
    $('sol-norte-valor').textContent = `${p.norte || 0}°`;
  }
  $('sol-norte').addEventListener('input', ev => {
    obra.plano.norte = Number(ev.target.value);
    $('sol-norte-valor').textContent = `${obra.plano.norte}°`;
    guardar(); PLANO.pintar();
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
      L.push(`SECTOR ${k + 1}: ${s.nombre}${s.superficie && !O.superficieZonas(obra) ? ` · ${fmt(s.superficie, 0)} m²` : ''}`);
      L.push(`Caño hasta la válvula: ${R.CANOS[s.alimentacion.material].nombre} ${s.alimentacion.nominal} mm, ${fmt(s.alimentacion.largo, 1)} m, desnivel ${fmt(s.alimentacion.desnivel, 1)} m. Válvula PGV 1": ${s.valvula ? 'sí' : 'no'}. Caño del sector: ${R.CANOS[s.lateral.material].nombre} ${s.lateral.nominal} mm, con tapón al final. ` +
        `Cada aspersor sale del caño con conector inicial, manguera ${R.MANGUERAS[s.manguera || 'pe-12'].nombre} (hasta 6 m) y espiga en L.`);
      if (O.tieneRamal(s)) L.push(`Caño principal dibujado en el plano: ${fmt(O.largoRamal(s), 1)} m con ${O.codosRamal(s)} codo(s), por los puntos ${[s.valvulaPos, ...s.ramal].map(p => `(${fmt(p.x, 1)}; ${fmt(p.y, 1)})`).join(' → ')}. La manguera de cada aspersor va en línea recta hasta el caño.`);
      if (c.error) { L.push(`Error de cálculo: ${c.error}`); return; }
      c.r.aspersores.forEach((a, i) => {
        const asp = s.aspersores[i];
        L.push(`  ${a.n}. ${a.emisor.tipo} ${a.emisor.nombre}${a.regulador ? ` en cuerpo ${a.regulador}` : ''} · a ${fmt(asp.distancia, 1)} m ${i ? "del anterior" : "de la válvula"} por el caño${asp.x == null ? " (sin ubicar en el plano)" : ""} · ${a.manguera > 0 ? `${fmt(a.manguera, 1)} m de manguera (pierde ${fmt(a.perdidaManguera, 2)} bar)` : 'directo al caño'} · ` +
          `${fmt(a.presionBoquilla, 2)} bar en la boquilla · ${fmt(a.caudal, 2)} l/min · alcance ${fmt(a.radio, 1)} m` +
          (asp.x != null ? ` · posición (${fmt(asp.x, 1)}; ${fmt(asp.y, 1)}) m, giro ${Math.round(asp.giro || 0)}°` : ''));
      });
      const caño = s.lateral.escalonado
        ? 'caño escalonado: ' + R.tramosPorDiametro(c.r.tramos).map(g => `${g.nominal} mm hasta el aspersor ${g.hasta} (${fmt(g.largo, 1)} m)`).join(' → ')
        : `caño de ${s.lateral.nominal} mm (con un solo diámetro se recomienda ${c.rec.recomendado ? c.rec.recomendado + ' mm' : 'ninguno: no cumple'})`;
      L.push(`Total del sector: ${fmt(c.r.caudalTotal, 1)} l/min · variación de presión ${fmt(c.r.variacion, 0)} % · ${caño}.`);
      for (const a of c.r.avisos) L.push(`  Aviso (${a.nivel}): ${a.texto}`);
    });
    if (obra.plano && aspersoresDelPlano().length) {
      const cob = GEO.cobertura(obra.plano, aspersoresDelPlano(), 0.25, obra.plano.zonas);
      const sup = O.superficieZonas(obra);
      L.push('');
      if (sup) L.push(`ZONAS A REGAR dibujadas en el plano: ${fmt(sup, 1)} m² en total; puntos de cada una: ${obra.plano.zonas.map(z => z.map(p => `(${fmt(p.x, 1)}; ${fmt(p.y, 1)})`).join(' ')).join(' | ')}.`);
      L.push(`COBERTURA DEL PLANO (todos los sectores${sup ? ', solo dentro de las zonas' : ''}): ${fmt(cob.seco, 0)} % seco, ${fmt(cob.uno, 0)} % con un solo aspersor, ${fmt(cob.bien, 0)} % bien cubierto.`);
      const norte = obra.plano.norte || 0;
      L.push(`ORIENTACIÓN: el norte está hacia ${SOL.ladoDelPlano(norte)} del plano (las posiciones x, y son en metros: x hacia la derecha, y hacia arriba). El lado de ${SOL.ladoDelPlano(norte)} recibe más sol.`);
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
    sugerirClientes();
    $('trabajo-caja').hidden = obra.tipo !== 'mantenimiento';
    $('obra-trabajo').value = obra.trabajo || '';
  }
  $('obra-trabajo').addEventListener('input', ev => { obra.trabajo = ev.target.value; guardar(); });
  // ---------- Clientes guardados (salen de las obras: el dato más reciente de cada nombre) ----------
  const clave = n => (n || '').trim().toLowerCase();
  function clientes() {
    const mapa = new Map();
    const obras = [...datos.obras].sort((a, b) => (b.actualizada || '').localeCompare(a.actualizada || ''));
    for (const o of obras) {
      const k = clave(o.cliente?.nombre);
      if (!k) continue;
      if (!mapa.has(k)) mapa.set(k, { cliente: { ...o.cliente }, obras: [] });
      mapa.get(k).obras.push(o);
    }
    return [...mapa.values()].sort((a, b) => a.cliente.nombre.localeCompare(b.cliente.nombre));
  }
  function pintarClientes() {
    const lista = clientes();
    $('lista-clientes').innerHTML = lista.length ? lista.map((c, n) => `<li class="cliente-item"><span>
        <b>${escapar(c.cliente.nombre)}</b><br><span class="ayuda">${escapar([c.cliente.direccion, c.cliente.localidad, c.cliente.telefono].filter(Boolean).join(' · ') || 'Sin más datos')}</span><br>
        ${c.obras.map(o => `<a class="enlace" href="#/obra/${o.id}/${o.tipo === 'mantenimiento' ? 'presupuesto' : 'plano'}">N° ${PDF.numeroTexto(o.presupuesto.numero)} · ${o.tipo === 'mantenimiento' ? 'Mantenimiento' : 'Riego'} · ${escapar(o.estado)}</a>`).join('<br>')}</span>
        <span class="acciones-cliente"><button type="button" class="chico" data-cliente-nuevo="${n}" data-tipo="mantenimiento">+ Mantenimiento</button>
        <button type="button" class="chico" data-cliente-nuevo="${n}" data-tipo="riego">+ Obra de riego</button></span></li>`).join('')
      : '<li class="ayuda">Todavía no hay clientes: aparecen cuando cargás el nombre en una obra.</li>';
  }
  $('lista-clientes').addEventListener('click', ev => {
    const b = ev.target.closest('[data-cliente-nuevo]');
    if (!b) return;
    const c = clientes()[Number(b.dataset.clienteNuevo)];
    const o = A.obraNueva(datos, b.dataset.tipo);
    o.cliente = { ...c.cliente };
    datos.obras.push(o);
    A.guardar(datos);
    ir(`#/obra/${o.id}/${b.dataset.tipo === 'mantenimiento' ? 'cliente' : 'plano'}`);
  });
  // Al escribir el nombre, sugiere los clientes guardados; si se elige uno, completa sus datos
  function sugerirClientes() {
    $('clientes-guardados').innerHTML = clientes().map(c => `<option value="${escapar(c.cliente.nombre)}">`).join('');
  }
  document.querySelector('[data-cliente="nombre"]').addEventListener('change', ev => {
    // Los datos salen de la obra más reciente de ese cliente (sin contar la que se está cargando)
    const otra = datos.obras.filter(o => o !== obra && clave(o.cliente?.nombre) === clave(ev.target.value))
      .sort((a, b) => (b.actualizada || '').localeCompare(a.actualizada || ''))[0];
    if (!otra) return;
    for (const campo of ['direccion', 'localidad', 'telefono', 'correo']) if (!obra.cliente[campo]) obra.cliente[campo] = otra.cliente[campo] || '';
    obra.cliente.nombre = otra.cliente.nombre;
    guardar(); pintarCliente();
  });
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
    copia.cobros = []; copia.gastos = [];
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
    sincronizarDistancias();
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
    $('alim-largo').disabled = true;   // colector: medio metro por válvula, lo pone la app
    $('alim-desnivel').value = s.alimentacion.desnivel;
    $('valvula').checked = s.valvula;
    s.lateral.material = opciones($('lat-material'), materiales, s.lateral.material);
    opciones($('lat-nominal'), [['auto', 'Automático (escalonado)'], ...diametros(s.lateral.material)], s.lateral.escalonado ? 'auto' : s.lateral.nominal);
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
    // En el plano la copia no va encima del original: los aspersores quedan sin ubicar, la válvula se ubica sola
    // y el caño principal se dibuja de nuevo.
    delete copia.valvulaPos; delete copia.ramal;
    for (const a of copia.aspersores) { delete a.x; delete a.y; }
    obra.sectores.splice(nSector + 1, 0, copia);
    if (obra.plano) window.GEOMETRIA.ubicarSinPosicion(obra.plano, obra.sectores);
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
    'lat-material': v => {
      const l = sector().lateral;
      l.material = v;
      const elegido = opciones($('lat-nominal'), [['auto', 'Automático (escalonado)'], ...diametros(v)], l.escalonado ? 'auto' : l.nominal);
      if (elegido !== 'auto') l.nominal = Number(elegido);
      else if (!R.CANOS[v].di[l.nominal]) l.nominal = Number(Object.keys(R.CANOS[v].di)[0]);
    },
    'lat-nominal': v => { const l = sector().lateral; l.escalonado = v === 'auto'; if (v !== 'auto') l.nominal = Number(v); },
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
    // El arco se escribe libre en todas (Darío). Las fijas que no traen ese arco pasan a la ajustable (OBRA.ponerArco).
    const libre = arcoLibre(a);
    const listaArcos = libre ? [] : arcos(a.tipo, a.boquilla);
    const conArco = libre || listaArcos.length > 0;
    li.querySelector('[data-solo=arco-libre]').hidden = !conArco;
    if (libre) a.arco = Math.min(360, Math.max(1, Math.round(Number(a.arco) || (esAjustable(a) || esMP(a) ? 180 : 360))));
    else if (conArco && !listaArcos.includes(Number(a.arco))) a.arco = listaArcos.includes(180) ? 180 : listaArcos[0];
    else a.arco = conArco ? Number(a.arco) : null;
    if (conArco) campo('arcoLibre').value = a.arco;
    // Con un arco que la boquilla no admite (por ejemplo una MP a 300°) no hay aspersor para calcular:
    // se sigue mostrando la tarjeta y el error aparece en el resultado del sector.
    let e, arcoInvalido = false;
    try { e = R.emisor(idEmisor(a)); } catch { e = deTipo(a.tipo).find(x => x.boquilla === a.boquilla); arcoInvalido = true; }
    const conCuerpo = e.cuerpo === 'Pro-Spray';
    li.querySelector('[data-solo=regulador]').hidden = !conCuerpo;
    if (!conCuerpo) a.regulador = '';
    campo('regulador').value = a.regulador || '';
    // Con el ramal dibujado en el plano, la distancia y la manguera salen de ahí (no se escriben).
    const ramal = O.tieneRamal(sector());
    campo('distancia').value = a.distancia;
    campo('distancia').disabled = usaPlano() || ramal;
    campo('altura').value = a.altura;
    campo('manguera').value = a.manguera ?? 0;
    campo('manguera').disabled = ramal;
    li.querySelector('.numero').textContent = i + 1;
    li.querySelector('[data-texto=distancia]').textContent = (i ? 'Caño desde el anterior' : 'Caño desde la válvula') + (usaPlano() || ramal ? ' (del plano)' : '');
    li.querySelector('.resumen').textContent = arcoInvalido ? `${a.tipo} ${a.boquilla}: arco de ${a.arco}° no válido`
      : `${e.tipo} ${e.nombre}${a.tipo === 'Turbina PGP Ultra' ? ` a ${a.arco}°` : ''}`;
  }
  lista.addEventListener('input', ev => {
    const li = ev.target.closest('.aspersor');
    const n = ev.target.dataset.campo;
    if (!li || !n) return;
    const i = Number(li.dataset.i), a = sector().aspersores[i];
    if (n === 'arcoLibre') return;   // el arco se toma al terminar de escribirlo (evento change, abajo)
    if (n === 'distancia' || n === 'altura' || n === 'manguera') a[n] = decimal(ev.target.value);
    else a[n] = ev.target.value;
    if (n === 'tipo') { a.boquilla = null; a.arco = null; }
    if (['tipo', 'boquilla', 'regulador'].includes(n)) completarAspersor(li, a, i);
    li.querySelector('[data-texto=aviso-arco]').hidden = true;
    pintarSector();
  });
  // Arco escrito a mano: si la boquilla fija no lo trae, pasa a la ajustable del mismo tamaño y avisa.
  lista.addEventListener('change', ev => {
    if (ev.target.dataset.campo !== 'arcoLibre') return;
    const li = ev.target.closest('.aspersor'), i = Number(li.dataset.i), a = sector().aspersores[i];
    const aviso = li.querySelector('[data-texto=aviso-arco]');
    try { aviso.textContent = O.ponerArco(a, decimal(ev.target.value)) || ''; }
    catch (err) { aviso.textContent = err.message; }
    completarAspersor(li, a, i);
    aviso.hidden = !aviso.textContent;
    pintarSector();
  });
  lista.addEventListener('click', ev => {
    const accion = ev.target.dataset.accion;
    if (!accion) return;
    const i = Number(ev.target.closest('.aspersor').dataset.i);
    const asps = sector().aspersores;
    if (accion === 'copiar') asps.splice(i + 1, 0, desplazado(asps[i]));
    if (accion === 'borrar') asps.splice(i, 1);
    sincronizarDistancias();
    armarAspersores();
    pintarSector();
  });
  // Copia de un aspersor: la misma tobera, sin ubicar en el plano (se ubica tocándolo en la lista "sin ubicar" del plano).
  function desplazado(a) {
    const { x, y, ...b } = a;
    return b;
  }
  $('agregar').addEventListener('click', () => {
    const asps = sector().aspersores;
    asps.push(asps.length ? desplazado(asps.at(-1)) : A.aspersorInicial(0));
    sincronizarDistancias();
    armarAspersores();
    pintarSector();
    lista.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  function pintarSector() {
    sincronizarDistancias();
    guardar();
    const caja = $('resultado');
    const c = calcular(sector());
    if (c.error) { caja.innerHTML = `<ul class="avisos"><li class="error">${escapar(c.error)}</li></ul>`; return; }
    const { r, rec } = c;
    const estimada = P.superficieEstimada(r, sector().aspersores);
    const zonas = O.superficieZonas(obra);
    $('superficie-ayuda').textContent = zonas
      ? `La mano de obra usa la zona a regar dibujada en el plano: ${fmt(zonas, 0)} m² en toda la obra. Este dato no se usa mientras haya zona dibujada.`
      : sector().superficie
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
    if (r.alimentacion) recorrido.push(`Colector a la salida de la bomba (${r.alimentacion.cano}, ${fmt(r.alimentacion.largo, 0)} m): pierde ${fmt(r.alimentacion.perdida, 2)} bar, el agua va a ${fmt(r.alimentacion.velocidad, 2)} m/s`);
    recorrido.push(`Llega a la válvula con <b>${fmt(r.presionValvula, 2)} bar</b>`);
    if (sector().valvula) recorrido.push(`La PGV de 1" pierde ${fmt(r.perdidaValvula, 2)} bar → sale con <b>${fmt(r.presionSalidaValvula, 2)} bar</b>`);
    const conManguera = r.aspersores.filter(a => a.manguera > 0);
    if (conManguera.length) {
      const pm = conManguera.map(a => a.perdidaManguera);
      recorrido.push(`Conector inicial, manguera y espiga de cada aspersor: pierden ${fmt(Math.min(...pm), 2)}${Math.max(...pm) - Math.min(...pm) >= 0.005 ? ` a ${fmt(Math.max(...pm), 2)}` : ''} bar`);
    }
    // "Entra" es la presión en la entrada del cuerpo (después de la manguera); se muestra si difiere de la boquilla o del caño.
    const hayReg = r.aspersores.some(a => a.regulador) || conManguera.length > 0;
    const filasAsp = r.aspersores.map((a, i) => `<tr>
      <td class="nombre">${a.n}. ${escapar(a.emisor.nombre)}${a.regulador ? ' · ' + a.regulador : ''}</td>
      ${hayReg ? `<td>${fmt(a.presionEntrada, 2)}</td>` : ''}
      <td class="${a.fuera < 0 ? 'mal' : ''}">${fmt(a.presionBoquilla, 2)}</td>
      <td>${fmt(a.caudal, 2)}</td><td>${fmt(a.radio, 1)}</td>
      <td class="${r.tramos[i].velocidad > R.VELOCIDAD_MAX ? 'mal' : ''}">${fmt(r.tramos[i].velocidad, 2)}</td></tr>`).join('');
    const escalonado = !!sector().lateral.escalonado, grupos = R.tramosPorDiametro(r.tramos);
    const filasDiam = rec.opciones.map(o => `<tr class="${o.nominal === rec.recomendado ? 'elegido' : ''}">
      <td>${o.nominal} mm</td><td>${fmt(o.caudal, 1)}</td>
      <td class="${o.velocidadMax > R.VELOCIDAD_MAX ? 'mal' : ''}">${fmt(o.velocidadMax, 2)}</td>
      <td class="${o.variacion > R.VARIACION_MAX ? 'mal' : ''}">${fmt(o.variacion, 0)} %</td>
      <td>${o.cumple ? 'Sí' : 'No'}</td></tr>`).join('');
    caja.innerHTML = `
      <div class="cifras">
        <div class="cifra"><b>${fmt(lpm, 1)}</b><span>l/min del sector</span></div>
        <div class="cifra"><b>${fmt(pMin, 2)}</b><span>bar en el aspersor más desfavorable</span></div>
        ${escalonado ? `<div class="cifra"><b>${grupos.map(g => g.nominal).join(' → ')} mm</b><span>caño del sector (automático)</span></div>`
          : `<div class="cifra"><b>${rec.recomendado ? rec.recomendado + ' mm' : '—'}</b><span>${rec.recomendado ? 'caño del sector recomendado'
          : rec.opciones.every(o => o.bajos > 0) ? 'ningún caño alcanza: falta presión en la fuente' : 'ningún caño cumple: ver la tabla de abajo'}</span></div>`}
      </div>
      ${avisos}
      <h3>Recorrido del agua</h3>
      <ul class="recorrido">${recorrido.map(t => `<li>${t}</li>`).join('')}</ul>
      <h3>Aspersores · variación de presión ${fmt(r.variacion, 0)} %</h3>
      <div class="tabla"><table>
        <thead><tr><th>Aspersor</th>${hayReg ? '<th>Entra<br>bar</th>' : ''}<th>Boquilla<br>bar</th><th>l/min</th><th>Alcance<br>m</th><th>Vel.<br>m/s</th></tr></thead>
        <tbody>${filasAsp}</tbody></table></div>
      <h3>Caño del sector: ${R.CANOS[sector().lateral.material].detalle}</h3>
      ${escalonado ? `<p>${grupos.map(g => `<b>${g.nominal} mm</b> ${g.desde === g.hasta ? `hasta el aspersor ${g.hasta}` : `del aspersor ${g.desde} al ${g.hasta}`} (${fmt(g.largo, 1)} m)`).join(' → ')}${grupos.length > 1 ? `, con ${grupos.length - 1} ${grupos.length === 2 ? 'reducción' : 'reducciones'}` : ''}.</p><p class="ayuda">Así quedaría con un solo diámetro:</p>` : ''}
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
    for (const [id, v] of [['pre-fecha', p.fecha], ['pre-validez', p.validez], ['pre-dia-obra', p.diaObra], ['pre-hora-obra', p.horaObra], ['pre-descuento', p.descuento], ['pre-desperdicio', p.desperdicio], ['pre-pago', p.formaPago], ['pre-notas', p.notas]]) {
      $(id).value = v ?? '';
      $(id).disabled = fijo;
    }
    $('pre-iva').checked = !!p.iva;
    $('pre-iva').disabled = fijo;
    $('pre-opciones').checked = !!p.opciones; $('pre-opciones').disabled = fijo;
    $('pre-total').value = typeof p.totalManual === 'number' ? fmt(p.totalManual, 2).replace(/,00$/, '') : ''; $('pre-total').disabled = fijo;
    $('pre-total').placeholder = p.opciones ? 'Vacío = según la opción' : 'Vacío = la suma';
    $('agregar-renglon').hidden = fijo;
    $('agregar-trabajo').hidden = fijo || obra.tipo !== 'mantenimiento';
    const mant = obra.tipo === 'mantenimiento';
    $('agregar-renglon').textContent = mant ? '+ Agregar material' : '+ Agregar renglón propio';
    $('pre-horas-caja').hidden = !mant;
    $('mo-caja').hidden = mant;
    if (!mant) {
      const m = pre.manoObra || {};
      $('mo-porcentaje').value = m.porcentaje ?? 200; $('mo-ajuste').value = m.ajuste ?? 0; $('mo-fijo').value = m.fijo ?? '';
      for (const id of ['mo-porcentaje', 'mo-ajuste', 'mo-fijo']) $(id).disabled = fijo;
      $('mo-ayuda').textContent = `Materiales a precio de venta: ${P.pesos(pre.materiales || 0)}. Mano de obra: ${P.pesos(pre.renglones.find(r => r.clave === 'mo-obra')?.importe || 0)}${m.fijo != null ? ' (importe fijo)' : ''}.`;
    }
    if (mant) {
      const horas = p.cambios['mo-hora']?.cantidad ?? obra.horas ?? 1, precio = datos.precios['mo-hora'] || 0;
      $('pre-horas').value = horas;
      $('pre-horas').disabled = fijo;
      $('pre-horas-ayuda').innerHTML = precio
        ? `${fmt(horas, 1)} h × ${P.pesos(precio)} la hora = <b>${P.pesos(horas * precio)}</b>. Los materiales van abajo, con su detalle y su importe.`
        : 'Falta el precio de la hora: escribilo en el renglón "Horas de trabajo" de abajo (queda guardado en la Lista de precios).';
    }
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
            <label>Cant. <span class="unidad">${escapar(r.unidad)}</span><input type="text" inputmode="decimal" autocomplete="off" step="any" min="0" data-r="cantidad" value="${r.cantidad}" ${dis}></label>
            <label>Precio unit. <span class="unidad">$</span><input type="text" inputmode="decimal" autocomplete="off" step="any" min="0" data-r="precio" value="${r.precio || ''}" placeholder="sin precio" ${dis}></label>
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
    const filas = pre.opciones ? [] : P.RUBROS.filter(rb => pre.subtotales[rb]).map(rb => `<tr><td>${rb}</td><td>${P.pesos(pre.subtotales[rb])}</td></tr>`);
    if (pre.descuento) filas.push(`<tr><td>Descuento ${fmt(pre.descuentoPct ?? obra.presupuesto.descuento, 0)} %</td><td>− ${P.pesos(pre.descuento)}</td></tr>`);
    if (pre.iva) filas.push(`<tr><td>IVA ${P.IVA} %</td><td>${P.pesos(pre.iva)}</td></tr>`);
    const ganancia = pre.costoMateriales > 0 ? `<p class="ayuda">Para vos (no sale en el PDF): los materiales te cuestan ${P.pesos(pre.costoMateriales)}; ganancia estimada ${P.pesos(pre.utilidad)}${pre.neto ? ` (${fmt(pre.utilidad / pre.neto * 100, 0)} % de lo que cobrás sin IVA)` : ''}${pre.sinCosto ? `. Ojo: ${pre.sinCosto} material${pre.sinCosto === 1 ? '' : 'es'} sin costo cargado` : ''}.</p>` : '';
    $('totales').innerHTML = `<table class="totales">${filas.join('')}<tr class="total-final"><td>Total</td><td>${pre.segunOpcion ? 'Según la opción elegida' : P.pesos(pre.total)}</td></tr></table>
      ${pre.opciones ? `<p class="ayuda">Son opciones: los renglones no se suman (la suma daría ${P.pesos(pre.totalCalculado)}). Si escribís un total a mano, sale ese.</p>` : pre.totalManual != null ? `<p class="ayuda">Total escrito a mano. La suma da ${P.pesos(pre.totalCalculado)}; borralo para volver a la suma.</p>` : ''}${ganancia}
      ${pre.sinPrecio ? `<ul class="avisos"><li class="aviso">${pre.sinPrecio} renglón${pre.sinPrecio === 1 ? '' : 'es'} sin precio: ${obra.tipo === 'mantenimiento' ? 'los materiales salen en el PDF como "A confirmar según relevamiento"; las horas sin precio no salen' : `no sale${pre.sinPrecio === 1 ? '' : 'n'} en el PDF hasta que le pongas uno`}.</li></ul>` : ''}`;
  }

  // Cambios en los renglones: mientras escribe se recalculan importe y total sin rearmar la lista (no pierde el foco).
  $('renglones').addEventListener('input', ev => {
    const campo = ev.target.dataset.r;
    const fila = ev.target.closest('.renglon');
    if (!campo || !fila || cerrado()) return;
    const p = obra.presupuesto;
    if (fila.dataset.clave) {
      const clave = fila.dataset.clave;
      if (campo === 'precio' && clave === 'mo-obra') { (p.manoObra ||= {}).fijo = decimal(ev.target.value); $('mo-fijo').value = p.manoObra.fijo; }
      else if (campo === 'precio') datos.precios[clave] = decimal(ev.target.value);
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
  for (const [id, campo] of [['mo-porcentaje', 'porcentaje'], ['mo-ajuste', 'ajuste'], ['mo-fijo', 'fijo']])
    $(id).addEventListener('change', ev => {
      const p = obra.presupuesto, v = ev.target.value.trim();
      p.manoObra ||= {};
      p.manoObra[campo] = campo === 'fijo' && v === '' ? null : decimal(v);
      guardar(); pintarPresupuesto();
    });
  $('pre-horas').addEventListener('change', ev => {
    obra.horas = Math.max(0, decimal(ev.target.value));
    if (obra.presupuesto.cambios['mo-hora']) delete obra.presupuesto.cambios['mo-hora'].cantidad;
    guardar(); pintarPresupuesto();
  });
  // Mantenimiento: otro renglón de horas con su detalle (por ejemplo, "Opción A: reparar el caño por afuera")
  $('agregar-trabajo').addEventListener('click', () => {
    obra.presupuesto.propios.push({ id: A.nuevoId(), rubro: 'Mano de obra', descripcion: '', unidad: 'h', cantidad: 1, precio: datos.precios['mo-hora'] || 0 });
    guardar(); pintarPresupuesto();
    [...document.querySelectorAll('#renglones .renglon[data-propio]')].at(-1)?.querySelector('input').focus();
  });
  $('agregar-renglon').addEventListener('click', () => {
    // En mantenimiento, cada material: detalle e importe (cantidad 1)
    const mant = obra.tipo === 'mantenimiento';
    obra.presupuesto.propios.push({ id: A.nuevoId(), rubro: mant ? 'Materiales' : 'Otros', descripcion: '', unidad: mant ? 'u' : 'gl', cantidad: 1, precio: 0 });
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
    'pre-dia-obra': v => obra.presupuesto.diaObra = v,
    'pre-hora-obra': v => obra.presupuesto.horaObra = v,
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
  $('pre-opciones').addEventListener('change', ev => {
    obra.presupuesto.opciones = ev.target.checked;
    $('pre-total').placeholder = ev.target.checked ? 'Vacío = según la opción' : 'Vacío = la suma';
    guardar(); pintarTotales(presupuestoDe(obra));
  });
  $('pre-total').addEventListener('input', ev => {
    const v = ev.target.value.trim();
    obra.presupuesto.totalManual = v === '' ? null : decimal(v);
    guardar(); pintarTotales(presupuestoDe(obra));
  });

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
      // Instalada en la pantalla de inicio del iPhone, abrir una ventana nueva puede no mostrar nada:
      // ahí se usa la hoja de compartir, que trae la vista previa del PDF (y deja guardarlo en Archivos).
      const instalada = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
      if (instalada && navigator.canShare && navigator.canShare({ files: [archivo] })) {
        try { await navigator.share({ files: [archivo], title: archivo.name }); } catch (err) { if (err.name !== 'AbortError') descargar(archivo); }
      } else {
        const w = window.open(URL.createObjectURL(archivo), '_blank');
        if (!w) descargar(archivo);
      }
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
    ['Manguera y conexiones', c => /^(manguera|conector|espiga|tapon|codo|te|reduccion|pegamento|conexion)-/.test(c)],
    ['Válvulas, caja y programador', c => /^(valvula|caja|programador)/.test(c)],
    ['Bombas', c => c.startsWith('bomba-')],
    ['Conexiones', c => true],
  ];
  function pintarPrecios() {
    // Materiales que aparecen en las obras, más la mano de obra por m² aunque no haya obras.
    const items = new Map([['mo-hora', { descripcion: 'Hora de trabajo (mantenimiento y reparaciones)', unidad: 'h' }]]);
    $('indice-venta').value = datos.indiceVenta ?? 40;
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
        const it = items.get(c), conCosto = !c.startsWith('mo-');
        return `<div class="precio-item"><span>${escapar(it.descripcion)} <span class="unidad">$ por ${escapar(it.unidad)}</span></span>
          <div class="campos dos">${conCosto ? `<label>Costo <input type="text" inputmode="decimal" autocomplete="off" data-costo="${escapar(c)}" value="${datos.costos[c] || ''}" placeholder="costo"></label>` : '<span></span>'}
          <label>Venta <input type="text" inputmode="decimal" autocomplete="off" data-precio="${escapar(c)}" value="${datos.precios[c] || ''}" placeholder="sin precio"></label></div></div>`;
      }).join('');
    }
    $('lista-precios').innerHTML = html;
  }
  $('lista-precios').addEventListener('input', ev => {
    const c = ev.target.dataset.precio, k = ev.target.dataset.costo;
    if (c) datos.precios[c] = decimal(ev.target.value);
    if (k) {
      // Al cargar el costo, la venta se calcula con el índice (se puede cambiar a mano)
      datos.costos[k] = decimal(ev.target.value);
      const venta = Math.round(datos.costos[k] * (1 + (datos.indiceVenta ?? 40) / 100));
      datos.precios[k] = venta;
      const v = $('lista-precios').querySelector(`[data-precio="${CSS.escape(k)}"]`);
      if (v) v.value = venta || '';
    }
    guardar();
  });
  $('indice-venta').addEventListener('change', ev => { datos.indiceVenta = decimal(ev.target.value); guardar(); });
  $('aplicar-indice').addEventListener('click', () => {
    for (const [k, costo] of Object.entries(datos.costos)) if (costo > 0) datos.precios[k] = Math.round(costo * (1 + (datos.indiceVenta ?? 40) / 100));
    guardar(); pintarPrecios();
  });

  // =====================================================================
  // Cobros y gastos de la obra, y caja de todas las obras
  // =====================================================================
  const SOCIOS = 2;   // Darío y Leandro, en partes iguales
  const fechaCorta = f => f ? f.split('-').reverse().join('/') : '';
  const nombreMes = m => { const [a, n] = m.split('-').map(Number); return n ? new Date(a, n - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }) : m; };
  const cifra = (v, texto, clase = '') => `<div class="cifra ${clase}"><b>${P.pesos(v)}</b><span>${texto}</span></div>`;

  function pintarCobros() {
    const c = O.cajaDeObra(obra, datos.precios);
    $('caja-obra').innerHTML = cifra(c.total, 'presupuesto') + cifra(c.cobrado, 'cobrado') + cifra(c.falta, 'falta cobrar')
      + cifra(c.gastado, 'gastado') + cifra(c.ganancia, `ganancia${c.margen != null ? ` (${fmt(c.margen, 0)} % de lo cobrado)` : ''}`, c.ganancia >= 0 ? 'ganancia' : 'perdida')
      + cifra(c.ganancia / SOCIOS, 'a cada socio (partes iguales)');
    $('caja-obra-ayuda').textContent = c.falta > 0
      ? `Cuando termine de cobrar, la ganancia prevista es de ${P.pesos(c.gananciaPrevista)} (si no hay más gastos).`
      : c.total ? 'La obra está cobrada.' : 'Todavía no hay presupuesto con importe.';
    const lista = (items, tipo, texto) => items.length ? items.map((x, i) => `<li><span>${fechaCorta(x.fecha)} · ${escapar(texto(x))}</span>
      <span><span class="monto">${P.pesos(x.importe)}</span> <button type="button" class="chico peligro" data-borrar-${tipo}="${i}">Quitar</button></span></li>`).join('')
      : `<li class="ayuda">Todavía no hay ${tipo === 'cobro' ? 'cobros' : 'gastos'}.</li>`;
    $('lista-cobros').innerHTML = lista(obra.cobros, 'cobro', x => [x.forma, x.nota].filter(Boolean).join(' · '));
    $('lista-gastos').innerHTML = lista(obra.gastos, 'gasto', x => x.detalle || 'Gasto');
    for (const id of ['cobro-fecha', 'gasto-fecha']) if (!$(id).value) $(id).value = A.hoy();
  }
  $('agregar-cobro').addEventListener('click', () => {
    const importe = decimal($('cobro-importe').value);
    if (!(importe > 0)) return $('cobro-importe').focus();
    obra.cobros.push({ fecha: $('cobro-fecha').value || A.hoy(), importe, forma: $('cobro-forma').value, nota: $('cobro-nota').value.trim() });
    $('cobro-importe').value = ''; $('cobro-nota').value = '';
    guardar(); pintarCobros();
  });
  $('agregar-gasto').addEventListener('click', () => {
    const importe = decimal($('gasto-importe').value);
    if (!(importe > 0)) return $('gasto-importe').focus();
    obra.gastos.push({ fecha: $('gasto-fecha').value || A.hoy(), importe, detalle: $('gasto-detalle').value.trim() || 'Gasto' });
    $('gasto-importe').value = ''; $('gasto-detalle').value = '';
    guardar(); pintarCobros();
  });
  // Quitar un cobro o un gasto pide un segundo toque
  $('panel-cobros').addEventListener('click', ev => {
    const b = ev.target.closest('[data-borrar-cobro], [data-borrar-gasto]');
    if (!b) return;
    if (!b.dataset.confirmar) { b.dataset.confirmar = '1'; b.textContent = 'Tocá de nuevo'; return; }
    const lista = b.dataset.borrarCobro != null ? obra.cobros : obra.gastos;
    lista.splice(Number(b.dataset.borrarCobro ?? b.dataset.borrarGasto), 1);
    guardar(); pintarCobros();
  });

  function pintarCaja() {
    const meses = O.cajaPorMes(datos.obras), actual = A.hoy().slice(0, 7);
    const m = meses.find(x => x.mes === actual) || { cobrado: 0, gastado: 0, ganancia: 0, acumulado: meses.at(-1)?.acumulado || 0 };
    const falta = datos.obras.filter(o => ['Aceptado', 'Terminado'].includes(o.estado)).reduce((t, o) => t + O.cajaDeObra(o, datos.precios).falta, 0);
    $('caja-mes-titulo').textContent = `Este mes: ${nombreMes(actual)}`;
    $('caja-mes').innerHTML = cifra(m.cobrado, 'cobrado') + cifra(m.gastado, 'gastado')
      + cifra(m.ganancia, 'ganancia', m.ganancia >= 0 ? 'ganancia' : 'perdida') + cifra(m.ganancia / SOCIOS, 'a cada socio')
      + cifra(meses.at(-1)?.acumulado || 0, 'ganancia acumulada') + cifra(falta, 'falta cobrar (obras aceptadas o terminadas)');
    $('caja-meses').innerHTML = meses.length ? `<table><thead><tr><th>Mes</th><th>Cobrado</th><th>Gastado</th><th>Ganancia</th><th>Acumulado</th></tr></thead>
      <tbody>${[...meses].reverse().map(x => `<tr><td class="nombre">${nombreMes(x.mes)}</td><td>${P.pesos(x.cobrado)}</td><td>${P.pesos(x.gastado)}</td>
      <td class="${x.ganancia < 0 ? 'mal' : ''}">${P.pesos(x.ganancia)}</td><td>${P.pesos(x.acumulado)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="ayuda">Todavía no hay cobros ni gastos cargados. Se cargan en cada obra, en la pestaña Cobros.</p>';
    const conMovimientos = datos.obras.filter(o => o.cobros.length || o.gastos.length || ['Aceptado', 'Terminado'].includes(o.estado));
    $('caja-obras').innerHTML = conMovimientos.length ? conMovimientos.map(o => {
      const c = O.cajaDeObra(o, datos.precios);
      return `<li><a href="#/obra/${o.id}/cobros"><span>${escapar(nombreObra(o))}<br><span class="ayuda">cobrado ${P.pesos(c.cobrado)} · gastado ${P.pesos(c.gastado)}${c.falta ? ` · falta ${P.pesos(c.falta)}` : ''}</span></span>
        <span class="monto ${c.ganancia < 0 ? 'mal' : ''}">${P.pesos(c.ganancia)}</span></a></li>`;
    }).join('') : '<li class="ayuda">Todavía no hay obras con cobros o gastos.</li>';
  }

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
  const fechaLarga = f => f.split('-').reverse().join('/');
  function pintarCopia() {
    const obras = `Tenés ${datos.obras.length} obra${datos.obras.length === 1 ? '' : 's'}`;
    const mb = new Blob([JSON.stringify(datos)]).size / 1048576;
    $('copia-info').textContent = (datos.ultimaCopia
      ? `Última copia: ${fechaLarga(datos.ultimaCopia)}${datos.cambiosSinCopia ? ' (después cambiaste cosas)' : ' (está al día)'}. `
      : 'Todavía no guardaste ninguna copia. ') + `${obras}; la copia pesa unos ${mb < 0.1 ? '0,1' : fmt(mb, 1)} MB.`;
  }
  // Recordatorio en Obras: hace 7 días o más que hay cambios sin copia.
  const DIAS_RECORDAR = 7;
  function pintarRecordatorio() {
    const dias = datos.cambiosSinCopia ? A.diasDesde(datos.cambiosSinCopia) : 0;
    $('recordar-copia').hidden = dias < DIAS_RECORDAR;
    $('recordar-copia-texto').textContent = datos.ultimaCopia
      ? `Hace ${A.diasDesde(datos.ultimaCopia)} días que no guardás una copia en ${NUBE} y desde entonces cambiaste cosas.`
      : `Todavía no guardaste ninguna copia de tus obras en ${NUBE}.`;
  }
  async function guardarCopia() {
    const archivo = new File([A.exportar(datos)], `Aspersia copia ${A.hoy()}.json`, { type: 'application/json' });
    let guardada = false;
    if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
      try { await navigator.share({ files: [archivo], title: archivo.name }); guardada = true; }
      catch (err) { if (err.name !== 'AbortError') { descargar(archivo); guardada = true; } }
    } else { descargar(archivo); guardada = true; }
    // Si cerró la hoja de compartir sin guardar, no cuenta como copia.
    if (guardada) { datos.ultimaCopia = A.hoy(); delete datos.cambiosSinCopia; await A.guardar(datos); }
    pintarCopia(); pintarRecordatorio();
  }
  $('exportar').addEventListener('click', guardarCopia);
  $('recordar-copia-boton').addEventListener('click', guardarCopia);
  $('importar').addEventListener('change', async ev => {
    const archivo = ev.target.files[0];
    if (!archivo) return;
    try {
      const nuevos = A.importar(await archivo.text());
      await A.guardarAparte('antes-de-recuperar', datos);
      for (const k of Object.keys(datos)) delete datos[k];
      Object.assign(datos, nuevos);
      delete datos.cambiosSinCopia;
      await A.guardar(datos);
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
