// Pantalla del cálculo de un sector. Arma el formulario, guarda lo cargado en el teléfono
// y recalcula con cada cambio usando window.RIEGO (app/calculo.js).

(function () {
  const R = window.RIEGO;
  const C = window.CZERWENY;
  const $ = id => document.getElementById(id);
  const fmt = R.fmt;
  const GUARDADO = 'aspersia.sector.v1';

  // ---------- Catálogo de aspersores para los menús ----------
  const EMISORES = R.emisores();
  const TIPOS = [...new Set(EMISORES.map(e => e.tipo))];
  const deTipo = tipo => EMISORES.filter(e => e.tipo === tipo);
  const boquillas = tipo => [...new Set(deTipo(tipo).map(e => e.boquilla))];
  const arcos = (tipo, boq) => deTipo(tipo).filter(e => e.boquilla === boq && e.arco != null).map(e => e.arco);
  const buscarEmisor = a => EMISORES.find(e => e.tipo === a.tipo && e.boquilla === a.boquilla && (e.arco == null || e.arco === Number(a.arco)));

  // Etiqueta de la boquilla con su alcance a la presión del medio de la tabla.
  function etiquetaBoquilla(tipo, boq) {
    const e = deTipo(tipo).find(x => x.boquilla === boq);
    const r = e.radios[Math.floor(e.radios.length / 2)];
    const nombre = e.tipo.startsWith('Turbina PGP Ultra') && e.arco == null ? e.nombre : boq;
    return `${nombre} · alcance ${fmt(r, 1)} m`;
  }

  // ---------- Estado ----------
  const inicial = () => ({
    fuente: { tipo: 'presion', bar: 3, linea: 'ZETA', modelo: 'ZETA 2', aspiracion: 0 },
    alimentacion: { material: 'pead-pn6', nominal: 32, largo: 10, desnivel: 0 },
    valvula: true,
    lateral: { material: 'pead-pn6', nominal: 25 },
    aspersores: [0, 1, 2, 3].map(i => ({ tipo: 'Boquilla Pro fija', boquilla: '12', arco: 180, regulador: 'PRS30', distancia: i ? 3.7 : 2, altura: 0 })),
    accesorios: 10,
  });
  let estado;
  try { estado = JSON.parse(localStorage.getItem(GUARDADO)) || inicial(); } catch { estado = inicial(); }
  const guardar = () => { try { localStorage.setItem(GUARDADO, JSON.stringify(estado)); } catch { /* sin almacenamiento: sigue igual */ } };

  // ---------- Menús fijos ----------
  const opciones = (sel, items, actual) => {
    sel.innerHTML = items.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    if (actual != null && items.some(([v]) => String(v) === String(actual))) sel.value = actual;
    return sel.value;
  };
  const materiales = Object.entries(R.CANOS).map(([k, c]) => [k, c.nombre]);
  const diametros = mat => Object.keys(R.CANOS[mat].di).map(n => [n, `${n} mm`]);

  function armarFijos() {
    document.querySelector(`input[name=fuente][value=${estado.fuente.tipo}]`).checked = true;
    $('presion').value = estado.fuente.bar;
    $('aspiracion').value = estado.fuente.aspiracion;
    estado.fuente.linea = opciones($('bomba-linea'), C.lineas.map(l => [l.linea, `${l.linea} · ${l.tipo}`]), estado.fuente.linea);
    armarModelos();
    estado.alimentacion.material = opciones($('alim-material'), materiales, estado.alimentacion.material);
    estado.alimentacion.nominal = Number(opciones($('alim-nominal'), diametros(estado.alimentacion.material), estado.alimentacion.nominal));
    $('alim-largo').value = estado.alimentacion.largo;
    $('alim-desnivel').value = estado.alimentacion.desnivel;
    $('valvula').checked = estado.valvula;
    estado.lateral.material = opciones($('lat-material'), materiales, estado.lateral.material);
    estado.lateral.nominal = Number(opciones($('lat-nominal'), diametros(estado.lateral.material), estado.lateral.nominal));
    $('accesorios').value = estado.accesorios;
    mostrarFuente();
  }
  function armarModelos() {
    const L = C.lineas.find(l => l.linea === estado.fuente.linea);
    $('bomba-uso').textContent = `Para: ${L.uso}.` + (L.origen === 'curva' ? ' Curva leída del gráfico (aproximada).' : '');
    estado.fuente.modelo = opciones($('bomba-modelo'),
      L.modelos.map(m => [m.modelo, `${m.modelo} · ${fmt(m.hp, m.hp % 1 ? 2 : 0)} HP · ${m.tension}`]), estado.fuente.modelo);
  }
  function mostrarFuente() {
    $('fuente-presion').hidden = estado.fuente.tipo !== 'presion';
    $('fuente-bomba').hidden = estado.fuente.tipo !== 'bomba';
  }

  // ---------- Lista de aspersores ----------
  const lista = $('aspersores');
  const plantilla = $('plantilla-aspersor');

  function armarAspersores() {
    lista.innerHTML = '';
    estado.aspersores.forEach((a, i) => {
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
    const listaArcos = arcos(a.tipo, a.boquilla);
    li.querySelector('[data-solo=arco]').hidden = !listaArcos.length;
    a.arco = listaArcos.length ? Number(opciones(campo('arco'), listaArcos.map(x => [x, `${x}°`]), a.arco)) : null;
    const e = buscarEmisor(a);
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
    const i = Number(li.dataset.i), a = estado.aspersores[i];
    a[n] = ['distancia', 'altura'].includes(n) ? numero(ev.target.value) : ev.target.value;
    if (n === 'tipo') { a.boquilla = null; a.arco = null; }
    if (n === 'arco') a.arco = Number(a.arco);
    if (['tipo', 'boquilla', 'arco', 'regulador'].includes(n)) completarAspersor(li, a, i);
    calcular();
  });
  lista.addEventListener('click', ev => {
    const accion = ev.target.dataset.accion;
    if (!accion) return;
    const i = Number(ev.target.closest('.aspersor').dataset.i);
    if (accion === 'copiar') estado.aspersores.splice(i + 1, 0, { ...estado.aspersores[i] });
    if (accion === 'borrar') {
      if (estado.aspersores.length === 1) return;
      estado.aspersores.splice(i, 1);
    }
    armarAspersores();
    calcular();
  });
  $('agregar').addEventListener('click', () => {
    const ultimo = estado.aspersores.at(-1);
    estado.aspersores.push({ ...ultimo });
    armarAspersores();
    calcular();
    lista.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // ---------- Resto del formulario ----------
  const numero = v => { const x = parseFloat(String(v).replace(',', '.')); return Number.isFinite(x) ? x : 0; };
  const enlaces = {
    presion: v => estado.fuente.bar = numero(v),
    aspiracion: v => estado.fuente.aspiracion = numero(v),
    'bomba-linea': v => { estado.fuente.linea = v; estado.fuente.modelo = null; armarModelos(); },
    'bomba-modelo': v => estado.fuente.modelo = v,
    'alim-material': v => { estado.alimentacion.material = v; estado.alimentacion.nominal = Number(opciones($('alim-nominal'), diametros(v), estado.alimentacion.nominal)); },
    'alim-nominal': v => estado.alimentacion.nominal = Number(v),
    'alim-largo': v => estado.alimentacion.largo = numero(v),
    'alim-desnivel': v => estado.alimentacion.desnivel = numero(v),
    'lat-material': v => { estado.lateral.material = v; estado.lateral.nominal = Number(opciones($('lat-nominal'), diametros(v), estado.lateral.nominal)); },
    'lat-nominal': v => estado.lateral.nominal = Number(v),
    accesorios: v => estado.accesorios = numero(v),
  };
  for (const [id, fn] of Object.entries(enlaces)) $(id).addEventListener('input', ev => { fn(ev.target.value); calcular(); });
  $('valvula').addEventListener('change', ev => { estado.valvula = ev.target.checked; calcular(); });
  document.querySelectorAll('input[name=fuente]').forEach(r => r.addEventListener('change', ev => {
    estado.fuente.tipo = ev.target.value; mostrarFuente(); calcular();
  }));

  // ---------- Cálculo y resultado ----------
  function sectorParaCalcular() {
    return {
      fuente: estado.fuente.tipo === 'bomba'
        ? { tipo: 'bomba', linea: estado.fuente.linea, modelo: estado.fuente.modelo, aspiracion: estado.fuente.aspiracion }
        : { tipo: 'presion', bar: estado.fuente.bar },
      alimentacion: estado.alimentacion,
      valvula: estado.valvula,
      lateral: estado.lateral,
      aspersores: estado.aspersores.map(a => ({ emisor: buscarEmisor(a).id, regulador: a.regulador || null, distancia: a.distancia, altura: a.altura })),
      accesorios: estado.accesorios,
    };
  }

  function calcular() {
    guardar();
    const caja = $('resultado');
    let r, rec;
    try {
      const s = sectorParaCalcular();
      r = R.calcularSector(s);
      rec = R.recomendarDiametro(s);
    } catch (err) {
      caja.innerHTML = `<ul class="avisos"><li class="error">${err.message}</li></ul>`;
      return;
    }
    const lpm = r.caudalTotal;
    const pMin = Math.min(...r.aspersores.map(a => a.presionBoquilla));
    const avisos = r.avisos.length
      ? `<ul class="avisos">${r.avisos.map(a => `<li class="${a.nivel}">${a.texto}</li>`).join('')}</ul>`
      : '<p class="todo-bien">Todo en orden: presiones dentro de las tablas, velocidades y variación de presión dentro de lo recomendado.</p>';

    const recorrido = [];
    if (r.fuente.bomba) recorrido.push(`Bomba ${r.fuente.bomba.modelo}: ${fmt(r.fuente.bomba.altura, 1)} m a ${fmt(lpm, 1)} l/min → <b>${fmt(r.fuente.presion, 2)} bar</b> a la salida${estado.fuente.aspiracion ? ` (descontando ${fmt(estado.fuente.aspiracion, 1)} m de aspiración)` : ''}`);
    else recorrido.push(`Fuente: <b>${fmt(r.fuente.presion, 2)} bar</b>`);
    if (r.alimentacion) recorrido.push(`Caño hasta la válvula (${r.alimentacion.cano}, ${fmt(r.alimentacion.largo, 0)} m): pierde ${fmt(r.alimentacion.perdida, 2)} bar, el agua va a ${fmt(r.alimentacion.velocidad, 2)} m/s`);
    recorrido.push(`Llega a la válvula con <b>${fmt(r.presionValvula, 2)} bar</b>`);
    if (estado.valvula) recorrido.push(`La PGV de 1" pierde ${fmt(r.perdidaValvula, 2)} bar → sale con <b>${fmt(r.presionSalidaValvula, 2)} bar</b>`);

    const filasAsp = r.aspersores.map((a, i) => `<tr>
      <td>${a.n}. ${a.emisor.nombre}${a.regulador ? ' · ' + a.regulador : ''}</td>
      <td>${fmt(a.presionEntrada, 2)}</td>
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
        <thead><tr><th>Aspersor</th><th>Entra<br>bar</th><th>Boquilla<br>bar</th><th>Caudal<br>l/min</th><th>Alcance<br>m</th><th>Vel. tramo<br>m/s</th></tr></thead>
        <tbody>${filasAsp}</tbody></table></div>
      <h3>Caño del sector: ${R.CANOS[estado.lateral.material].detalle}</h3>
      <div class="tabla"><table>
        <thead><tr><th>Diámetro</th><th>Caudal<br>l/min</th><th>Vel. máx.<br>m/s</th><th>Variación<br>presión</th><th>Cumple</th></tr></thead>
        <tbody>${filasDiam}</tbody></table></div>
      <p class="ayuda">Cumple = el agua no pasa de ${fmt(R.VELOCIDAD_MAX, 1)} m/s, la presión no varía más del ${R.VARIACION_MAX} % y ningún aspersor queda por debajo de su tabla.
      Caudales del catálogo Hunter 2026; donde el catálogo da dos caudales distintos para la misma boquilla se usa el mayor.</p>`;
  }

  armarFijos();
  armarAspersores();
  calcular();
})();
