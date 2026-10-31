// Guardado de Aspersia en el teléfono: obras (con su cliente, diseño y presupuesto), lista de precios y datos del instalador.
// Pasa solo lo cargado con versiones anteriores (una obra o un sector sueltos) a la primera obra.

(function (global) {
  const CLAVE = 'aspersia.datos.v3';
  const VIEJAS = ['aspersia.obra.v1', 'aspersia.sector.v1'];
  const ESTADOS = ['Borrador', 'Enviado', 'Aceptado', 'Terminado', 'Rechazado'];

  const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const hoy = () => new Date().toISOString().slice(0, 10);

  // Como instala Darío: caño de PVC K6 (Tigre) desde la bomba a las válvulas y en el ramal de cada sector,
  // que termina con tapón; de ahí, conector inicial + manguera de polietileno (hasta 6 m) + espiga en L a cada aspersor.
  const aspersorInicial = i => ({ tipo: 'Boquilla Pro fija', boquilla: '12', arco: 180, regulador: 'PRS30', distancia: i ? 3.7 : 2, altura: 0, manguera: 1 });
  const sectorNuevo = n => ({
    nombre: `Sector ${n}`,
    superficie: 0,
    alimentacion: { material: 'pvc-k6', nominal: 40, largo: 0.5, desnivel: 0 },   // colector a la salida de la bomba
    valvula: true,
    lateral: { material: 'pvc-k6', nominal: 32, escalonado: true },   // automático: el diámetro de cada tramo lo calcula la app
    manguera: 'pe-12',
    aspersores: [],   // sin fila de ejemplo (Darío): se agregan en el plano con "+ Aspersor" o en Diseño
  });
  function obraNueva(datos) {
    const numero = datos.siguienteNumero++;
    return {
      id: nuevoId(), creada: hoy(), actualizada: hoy(), estado: 'Borrador',
      nombre: '',
      cliente: { nombre: '', direccion: '', localidad: '', telefono: '', correo: '' },
      fuente: { tipo: 'presion', bar: 3, linea: 'ZETA', modelo: 'ZETA 2', aspiracion: 0 },
      accesorios: 10,
      sectores: [sectorNuevo(1)],
      plano: planoNuevo(),
      presupuesto: {
        numero, fecha: hoy(), validez: 15,
        formaPago: '50 % al aceptar y 50 % al terminar la obra.',
        notas: 'Incluye materiales, instalación, puesta en marcha y programación.',
        desperdicio: 10, descuento: 0, iva: false, cambios: {}, propios: [], congelado: null,
      },
    };
  }
  const datosNuevos = () => ({
    version: 3,
    instalador: { nombre: '', comercial: 'Aspersia · Riegos Tecnológicos', telefono: '', correo: '', direccion: '', cuit: '', pie: '' },
    precios: {},
    siguienteNumero: 1,
    obras: [],
  });

  function cargar() {
    let datos = null;
    try { datos = JSON.parse(localStorage.getItem(CLAVE)); } catch { /* dato roto o sin almacenamiento */ }
    if (datos && datos.version === 3) return completar(datos);
    datos = datosNuevos();
    // Versiones anteriores: v2 guardaba una obra suelta; v1, un sector suelto.
    try {
      const v2 = JSON.parse(localStorage.getItem(VIEJAS[0]));
      const v1 = !v2 && JSON.parse(localStorage.getItem(VIEJAS[1]));
      if (v2 || v1) {
        const o = obraNueva(datos);
        if (v2) Object.assign(o, { nombre: v2.nombre || '', fuente: v2.fuente, accesorios: v2.accesorios ?? 10, sectores: v2.sectores });
        else { const { fuente, accesorios, ...sector } = v1; Object.assign(o, { fuente, accesorios: accesorios ?? 10, sectores: [{ nombre: 'Sector 1', ...sector }] }); }
        datos.obras.push(o);
      }
    } catch { /* nada que pasar */ }
    return completar(datos);
  }
  // Asegura los campos que agregan las versiones nuevas.
  function completar(datos) {
    for (const o of datos.obras) {
      o.cliente ||= { nombre: '', direccion: '', localidad: '', telefono: '', correo: '' };
      o.plano ||= planoNuevo();
      o.plano.zonas ??= [];          // zonas a regar dibujadas sobre la foto
      o.plano.norte ??= 0;           // rumbo del norte en el plano (0 = arriba, como Google Maps)
      o.plano.verSol ??= false;      // degradé del lado del sol
      // Se sacó marcar casas, muros y árboles (30-oct-2026): se borra lo que haya quedado guardado.
      delete o.plano.sombras; delete o.plano.epoca; delete o.plano.latitud;
      for (const s of o.sectores) {
        s.superficie ??= 0;
        // Obras de antes de la manguera: se agrega el tipo, pero cada aspersor queda con 0 m (como estaba calculado).
        s.manguera ??= 'pe-12';
        s.lateral.escalonado ??= false;   // obras de antes: el diámetro que tenían
        for (const a of s.aspersores) a.manguera ??= 0;
      }
    }
    return datos;
  }
  // Terreno del plano en metros. Las posiciones de aspersores y válvulas se guardan en cada sector.
  const planoNuevo = () => ({ ancho: 20, largo: 15, fuente: { x: 0.5, y: 0.5 }, distanciasDesdePlano: false, verCobertura: true });

  // ---------- Dónde se guarda ----------
  // localStorage solo admite ~5 MB por app web: con fotos de fondo se llena. Los datos van a IndexedDB,
  // que en el iPhone admite cientos de MB. Si IndexedDB no está (pruebas, modo privado), se sigue con localStorage.
  const BASE = 'aspersia', ALMACEN_IDB = 'datos', PRINCIPAL = 'principal';
  let base = null;   // conexión abierta a IndexedDB, o null si se usa localStorage

  const pedido = req => new Promise((listo, error) => { req.onsuccess = () => listo(req.result); req.onerror = () => error(req.error); });
  function abrirBase() {
    if (!global.indexedDB) return Promise.resolve(null);
    const req = indexedDB.open(BASE, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(ALMACEN_IDB);
    return pedido(req).catch(() => null);
  }
  const leer = clave => pedido(base.transaction(ALMACEN_IDB).objectStore(ALMACEN_IDB).get(clave));
  function escribir(clave, valor) {
    const tx = base.transaction(ALMACEN_IDB, 'readwrite');
    tx.objectStore(ALMACEN_IDB).put(valor, clave);
    return new Promise((listo, error) => { tx.oncomplete = () => listo(); tx.onerror = tx.onabort = () => error(tx.error); });
  }

  // Abre los datos al arrancar. La primera vez pasa lo que había en localStorage a IndexedDB y libera ese lugar.
  async function abrir() {
    base = await abrirBase();
    // Que el iPhone no borre estos datos aunque le falte lugar (en la app instalada suele concederlo solo).
    try { await navigator.storage?.persist?.(); } catch { /* no disponible */ }
    if (!base) return cargar();
    let datos = null;
    try { datos = await leer(PRINCIPAL); } catch { /* base rota: se intenta con lo de antes */ }
    if (datos && datos.version === 3) return completar(datos);
    datos = cargar();
    try {
      await escribir(PRINCIPAL, datos);
      if ((await leer(PRINCIPAL))?.version === 3) localStorage.removeItem(CLAVE);
    } catch { base = null; }   // si IndexedDB falla, se sigue con localStorage
    return datos;
  }

  // Guarda todo. Devuelve una promesa: true si se guardó, false si no hay lugar.
  async function guardar(datos) {
    if (base) {
      try { await escribir(PRINCIPAL, datos); return true; } catch { return false; }
    }
    try { localStorage.setItem(CLAVE, JSON.stringify(datos)); return true; } catch { return false; }
  }
  // Una copia aparte (por ejemplo, lo que había antes de recuperar una copia de seguridad).
  async function guardarAparte(nombre, datos) {
    if (base) { try { await escribir(nombre, structuredClone(datos)); return true; } catch { return false; } }
    try { localStorage.setItem(`${CLAVE}.${nombre}`, JSON.stringify(datos)); return true; } catch { return false; }
  }

  // Días desde una fecha AAAA-MM-DD hasta hoy.
  const diasDesde = fecha => Math.floor((Date.parse(hoy()) - Date.parse(fecha)) / 86400000);

  // Copia de seguridad: todo en un archivo .json que se puede volver a cargar.
  function exportar(datos) {
    return new Blob([JSON.stringify({ app: 'Aspersia', exportado: new Date().toISOString(), ...datos }, null, 1)], { type: 'application/json' });
  }
  function importar(texto) {
    const d = JSON.parse(texto);
    if (d.app !== 'Aspersia' || d.version !== 3 || !Array.isArray(d.obras)) throw new Error('El archivo no es una copia de seguridad de Aspersia.');
    delete d.app; delete d.exportado;
    return completar(d);
  }

  global.ALMACEN = { ESTADOS, abrir, cargar, guardar, guardarAparte, diasDesde, obraNueva, sectorNuevo, aspersorInicial, nuevoId, hoy, exportar, importar };
})(typeof window !== 'undefined' ? window : globalThis);
