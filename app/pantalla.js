// Pantalla de Aspersia: una obra con una fuente de agua y varios sectores.
// Vista "obra": nombre, fuente, lista de sectores con su resumen. Vista "sector": caños, aspersores y resultado.
// Guarda todo en el teléfono y recalcula con cada cambio usando window.RIEGO (app/calculo.js).

(function () {
  const R = window.RIEGO;
  const C = window.CZERWENY;
  const $ = id => document.getElementById(id);
  const fmt = R.fmt;
  const GUARDADO = 'aspersia.obra.v1';
  const GUARDADO_VIEJO = 'aspersia.sector.v1';   // versión de un solo sector

  // ---------- Catálogo de aspersores para los menús ----------
  const EMISORES = R.emisores();
  const TIPOS = [...new Set(EMISORES.map(e => e.tipo))];
  const deTipo = tipo => EMISORES.filter(e => e.tipo === tipo);
  const boquillas = tipo => [...new Set(deTipo(tipo).map(e => e.boquilla))];
  const arcos = (tipo, boq) => deTipo(tipo).filter(e => e.boquilla === boq && e.arco != null).map(e => e.arco);
  const esAjustable = a => a.tipo === R.TIPO_AJUSTABLE;

  // Id del aspersor para el cálculo. Las ajustables aceptan cualquier arco.
  function idEmisor(a) {
    if (esAjustable(a)) return `pro-${a.boquilla}@${a.arco}`;
    const e = EMISORES.find(e => e.tipo === a.tipo && e.boquilla === a.boquilla && (e.arco == null || e.arco === Number(a.arco)));
    return e && e.id;
  }

  // Etiqueta de la boquilla con su alcance a la presión del medio de la tabla.
  function etiquetaBoquilla(tipo, boq) {
    const e = deTipo(tipo).find(x => x.boquilla === boq);
    const r = e.radios[Math.floor(e.radios.length / 2)];
    const nombre = e.tipo.startsWith('Turbina PGP Ultra') && e.arco == null ? e.nombre : boq;
    return `${nombre} · alcance ${fmt(r, 1)} m`;
  }

  // ---------- Estado ----------
  const aspersorInicial = i => ({ tipo: 'Boquilla Pro fija', boquilla: '12', arco: 180, regulador: 'PRS30', distancia: i ? 3.7 : 2, altura: 0 });
  const sectorNuevo = n => ({
    nombre: `Sector ${n}`,
    alimentacion: { material: 'pead-pn6', nominal: 32, largo: 10, desnivel: 0 },
    valvula: true,
    lateral: { material: 'pead-pn6', nominal: 25 },
    aspersores: [0, 1, 2, 3].map(aspersorInicial),
  });
  const obraNueva = () => ({
    nombre: '',
    fuente: { tipo: 'presion', bar: 3, linea: 'ZETA', modelo: 'ZETA 2', aspiracion: 0 },
    accesorios: 10,
    sectores: [sectorNuevo(1)],
  });

  function cargar() {
    try {
      const obra = JSON.parse(localStorage.getItem(GUARDADO));
      if (obra && obra.sectores && obra.sectores.length) return obra;
      // Lo cargado con la versión de un solo sector pasa a ser el Sector 1.
      const viejo = JSON.parse(localStorage.getItem(GUARDADO_VIEJO));
      if (viejo && viejo.aspersores) {
        const { fuente, accesorios, ...sector } = viejo;
        return { nombre: '', fuente, accesorios: accesorios ?? 10, sectores: [{ nombre: 'Sector 1', ...sector }] };
      }
    } catch { /* sin almacenamiento o dato roto: arranca de cero */ }
    return obraNueva();
  }
  const obra = cargar();
  let actual = null;   // índice del sector abierto, o null en la vista de la obra
  const guardar = () => { try { localStorage.setItem(GUARDADO, JSON.stringify(obra)); } catch { /* sin almacenamiento */ } };

  // ---------- Utilidades de formulario ----------
  const opciones = (sel, items, valor) => {
    sel.innerHTML = items.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    if (valor != null && items.some(([v]) => String(v) === String(valor))) sel.value = valor;
    return sel.value;
  };
  const numero = v => { const x = parseFloat(String(v).replace(',', '.')); return Number.isFinite(x) ? x : 0; };
  const escapar = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const materiales = Object.entries(R.CANOS).map(([k, c]) => [k, c.nombre]);
  const diametros = mat => Object.keys(R.CANOS[mat].di).map(n => [n, `${n} mm`]);

  // ---------- Cálculo ----------
  function sectorParaCalcular(s) {
    return {
      fuente: obra.fuente.tipo === 'bomba'
        ? { tipo: 'bomba', linea: obra.fuente.linea, modelo: obra.fuente.modelo, aspiracion: obra.fuente.aspiracion }
        : { tipo: 'presion', bar: obra.fuente.bar },
      alimentacion: s.alimentacion,
      valvula: s.valvula,
      lateral: s.lateral,
      aspersores: s.aspersores.map(a => ({ emisor: idEmisor(a), regulador: a.regulador || null, distancia: a.distancia, altura: a.altura })),
      accesorios: obra.accesorios,
    };
  }
  function calcular(s) {
    try {
      const datos = sectorParaCalcular(s);
      return { r: R.calcularSector(datos), rec: R.recomendarDiametro(datos) };
    } catch (err) {
      return { error: err.message };
    }
  }
  const peorNivel = r => r.error ? 'error' : ['error', 'aviso', 'info'].find(n => r.r.avisos.some(a => a.nivel === n)) || 'bien';
  const ESTADO = { error: 'Hay problemas', aviso: 'Revisar avisos', info: 'Bien, con notas', bien: 'Todo bien' };

  // ---------- Vista de la obra ----------
  function mostrarObra() {
    actual = null;
    $('vista-obra').hidden = false;
    $('vista-sector').hidden = true;
    $('subtitulo').textContent = obra.nombre ? `Obra: ${obra.nombre}` : 'Riegos Tecnológicos';
    if (location.hash) history.replaceState(null, '', location.pathname);
    pintarObra();
  }

  function armarFuente() {
    $('obra-nombre').value = obra.nombre;
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

  // Tarjetas de los sectores y resumen de la obra.
  function pintarObra() {
    guardar();
    const calculos = obra.sectores.map(calcular);
    $('lista-sectores').innerHTML = obra.sectores.map((s, i) => {
      const c = calculos[i], nivel = peorNivel(c);
      const datos = c.error ? escapar(c.error)
        : `${fmt(c.r.caudalTotal, 1)} l/min · ${fmt(Math.min(...c.r.aspersores.map(a => a.presionBoquilla)), 2)} bar en el más desfavorable`;
      return `<li><button type="button" class="sector-tarjeta" data-sector="${i}">
        <span class="sector-nombre">${escapar(s.nombre || `Sector ${i + 1}`)}</span>
        <span class="sector-datos">${s.aspersores.length} aspersor${s.aspersores.length === 1 ? '' : 'es'} · ${datos}</span>
        <span class="estado ${nivel}">${ESTADO[nivel]}</span>
      </button></li>`;
    }).join('');

    const validos = calculos.map((c, i) => ({ c, s: obra.sectores[i], i })).filter(x => !x.c.error);
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

  $('lista-sectores').addEventListener('click', ev => {
    const b = ev.target.closest('[data-sector]');
    if (b) abrirSector(Number(b.dataset.sector));
  });
  $('agregar-sector').addEventListener('click', () => {
    obra.sectores.push(sectorNuevo(obra.sectores.length + 1));
    abrirSector(obra.sectores.length - 1);
  });
  $('obra-nombre').addEventListener('input', ev => { obra.nombre = ev.target.value; $('subtitulo').textContent = obra.nombre ? `Obra: ${obra.nombre}` : 'Riegos Tecnológicos'; guardar(); });

  const enlacesObra = {
    presion: v => obra.fuente.bar = numero(v),
    aspiracion: v => obra.fuente.aspiracion = numero(v),
    'bomba-linea': v => { obra.fuente.linea = v; obra.fuente.modelo = null; armarModelos(); },
    'bomba-modelo': v => obra.fuente.modelo = v,
    accesorios: v => obra.accesorios = numero(v),
  };
  for (const [id, fn] of Object.entries(enlacesObra)) $(id).addEventListener('input', ev => { fn(ev.target.value); pintarObra(); });
  document.querySelectorAll('input[name=fuente]').forEach(r => r.addEventListener('change', ev => {
    obra.fuente.tipo = ev.target.value;
    $('fuente-presion').hidden = obra.fuente.tipo !== 'presion';
    $('fuente-bomba').hidden = obra.fuente.tipo !== 'bomba';
    pintarObra();
  }));

  // ---------- Vista de un sector ----------
  const sector = () => obra.sectores[actual];

  function abrirSector(i) {
    actual = i;
    $('vista-obra').hidden = true;
    $('vista-sector').hidden = false;
    const s = sector();
    $('subtitulo').textContent = (obra.nombre ? `${obra.nombre} · ` : '') + (s.nombre || `Sector ${i + 1}`);
    $('sector-nombre').value = s.nombre;
    s.alimentacion.material = opciones($('alim-material'), materiales, s.alimentacion.material);
    s.alimentacion.nominal = Number(opciones($('alim-nominal'), diametros(s.alimentacion.material), s.alimentacion.nominal));
    $('alim-largo').value = s.alimentacion.largo;
    $('alim-desnivel').value = s.alimentacion.desnivel;
    $('valvula').checked = s.valvula;
    s.lateral.material = opciones($('lat-material'), materiales, s.lateral.material);
    s.lateral.nominal = Number(opciones($('lat-nominal'), diametros(s.lateral.material), s.lateral.nominal));
    $('borrar-sector').disabled = obra.sectores.length === 1;
    armarAspersores();
    pintarSector();
    if (location.hash !== `#sector-${i + 1}`) history.pushState(null, '', `#sector-${i + 1}`);
    window.scrollTo(0, 0);
  }

  $('volver').addEventListener('click', () => { mostrarObra(); window.scrollTo(0, 0); });
  $('volver-abajo').addEventListener('click', () => { mostrarObra(); window.scrollTo(0, 0); });
  window.addEventListener('popstate', () => { if (!location.hash && actual != null) mostrarObra(); });
  $('sector-nombre').addEventListener('input', ev => {
    sector().nombre = ev.target.value;
    $('subtitulo').textContent = (obra.nombre ? `${obra.nombre} · ` : '') + (ev.target.value || `Sector ${actual + 1}`);
    guardar();
  });
  $('copiar-sector').addEventListener('click', () => {
    const copia = JSON.parse(JSON.stringify(sector()));
    copia.nombre = `${sector().nombre} (copia)`;
    obra.sectores.splice(actual + 1, 0, copia);
    abrirSector(actual + 1);
  });
  $('borrar-sector').addEventListener('click', () => {
    if (obra.sectores.length === 1) return;
    obra.sectores.splice(actual, 1);
    mostrarObra();
  });

  const enlacesSector = {
    'alim-material': v => { sector().alimentacion.material = v; sector().alimentacion.nominal = Number(opciones($('alim-nominal'), diametros(v), sector().alimentacion.nominal)); },
    'alim-nominal': v => sector().alimentacion.nominal = Number(v),
    'alim-largo': v => sector().alimentacion.largo = numero(v),
    'alim-desnivel': v => sector().alimentacion.desnivel = numero(v),
    'lat-material': v => { sector().lateral.material = v; sector().lateral.nominal = Number(opciones($('lat-nominal'), diametros(v), sector().lateral.nominal)); },
    'lat-nominal': v => sector().lateral.nominal = Number(v),
  };
  for (const [id, fn] of Object.entries(enlacesSector)) $(id).addEventListener('input', ev => { fn(ev.target.value); pintarSector(); });
  $('valvula').addEventListener('change', ev => { sector().valvula = ev.target.checked; pintarSector(); });

  // ---------- Aspersores del sector ----------
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

  // Ajusta los menús de un aspersor a lo elegido (tipo → boquilla → arco) y muestra solo lo que corresponde.
  function completarAspersor(li, a, i) {
    const campo = n => li.querySelector(`[data-campo=${n}]`);
    a.tipo = opciones(campo('tipo'), TIPOS.map(t => [t, t]), a.tipo);
    a.boquilla = opciones(campo('boquilla'), boquillas(a.tipo).map(b => [b, etiquetaBoquilla(a.tipo, b)]), a.boquilla);
    const ajustable = esAjustable(a);
    const listaArcos = ajustable ? [] : arcos(a.tipo, a.boquilla);
    li.querySelector('[data-solo=arco]').hidden = !listaArcos.length;
    li.querySelector('[data-solo=arco-libre]').hidden = !ajustable;
    if (ajustable) {
      a.arco = Math.min(360, Math.max(1, Math.round(Number(a.arco) || 180)));
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
    campo('altura').value = a.altura;
    li.querySelector('.numero').textContent = i + 1;
    li.querySelector('[data-texto=distancia]').textContent = i ? 'Distancia al anterior' : 'Distancia a la válvula';
    li.querySelector('.resumen').textContent = `${e.tipo} ${e.nombre}`;
  }

  lista.addEventListener('input', ev => {
    const li = ev.target.closest('.aspersor');
    const n = ev.target.dataset.campo;
    if (!li || !n) return;
    const i = Number(li.dataset.i), a = sector().aspersores[i];
    if (n === 'distancia' || n === 'altura') a[n] = numero(ev.target.value);
    else if (n === 'arcoLibre') {
      const v = numero(ev.target.value);
      if (v < 1 || v > 360) return;            // espera a que termine de escribir un arco válido
      a.arco = Math.round(v);
    } else a[n] = ev.target.value;
    if (n === 'tipo') { a.boquilla = null; a.arco = null; }
    if (n === 'arco') a.arco = Number(a.arco);
    if (['tipo', 'boquilla', 'arco', 'regulador'].includes(n)) completarAspersor(li, a, i);
    if (n === 'arcoLibre') li.querySelector('.resumen').textContent = `${a.tipo} ${a.boquilla} ${a.arco}°`;
    pintarSector();
  });
  lista.addEventListener('click', ev => {
    const accion = ev.target.dataset.accion;
    if (!accion) return;
    const i = Number(ev.target.closest('.aspersor').dataset.i);
    const asps = sector().aspersores;
    if (accion === 'copiar') asps.splice(i + 1, 0, { ...asps[i] });
    if (accion === 'borrar') {
      if (asps.length === 1) return;
      asps.splice(i, 1);
    }
    armarAspersores();
    pintarSector();
  });
  $('agregar').addEventListener('click', () => {
    const asps = sector().aspersores;
    asps.push({ ...asps.at(-1) });
    armarAspersores();
    pintarSector();
    lista.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // ---------- Resultado del sector ----------
  function pintarSector() {
    guardar();
    const caja = $('resultado');
    const c = calcular(sector());
    if (c.error) { caja.innerHTML = `<ul class="avisos"><li class="error">${escapar(c.error)}</li></ul>`; return; }
    const { r, rec } = c;
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

    const hayReguladores = r.aspersores.some(a => a.regulador);
    const filasAsp = r.aspersores.map((a, i) => `<tr>
      <td class="nombre">${a.n}. ${escapar(a.emisor.nombre)}${a.regulador ? ' · ' + a.regulador : ''}</td>
      ${hayReguladores ? `<td>${fmt(a.presionEntrada, 2)}</td>` : ''}
      <td class="${a.fuera < 0 ? 'mal' : ''}">${fmt(a.presionBoquilla, 2)}</td>
      <td>${fmt(a.caudal, 2)}</td>
      <td>${fmt(a.radio, 1)}</td>
      <td class="${r.tramos[i].velocidad > R.VELOCIDAD_MAX ? 'mal' : ''}">${fmt(r.tramos[i].velocidad, 2)}</td>
    </tr>`).join('');

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
        <thead><tr><th>Aspersor</th>${hayReguladores ? '<th>Entra<br>bar</th>' : ''}<th>Boquilla<br>bar</th><th>l/min</th><th>Alcance<br>m</th><th>Vel.<br>m/s</th></tr></thead>
        <tbody>${filasAsp}</tbody></table></div>
      <h3>Caño del sector: ${R.CANOS[sector().lateral.material].detalle}</h3>
      <div class="tabla"><table>
        <thead><tr><th>Diámetro</th><th>l/min</th><th>Vel. máx.<br>m/s</th><th>Variación<br>presión</th><th>Cumple</th></tr></thead>
        <tbody>${filasDiam}</tbody></table></div>
      <p class="ayuda">Cumple = el agua no pasa de ${fmt(R.VELOCIDAD_MAX, 1)} m/s, la presión no varía más del ${R.VARIACION_MAX} % y ningún aspersor queda por debajo de su tabla.
      Caudales del catálogo Hunter 2026; donde el catálogo da dos caudales distintos para la misma boquilla se usa el mayor.</p>`;
  }

  // ---------- Arranque ----------
  armarFuente();
  const desdeEnlace = /^#sector-(\d+)$/.exec(location.hash);
  const n = desdeEnlace ? Number(desdeEnlace[1]) - 1 : -1;
  if (n >= 0 && n < obra.sectores.length) abrirSector(n); else mostrarObra();
})();
