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
    alimentacion: { material: 'pvc-k6', nominal: 40, largo: 10, desnivel: 0 },
    valvula: true,
    lateral: { material: 'pvc-k6', nominal: 32 },
    manguera: 'pe-12',
    aspersores: [0, 1, 2, 3].map(aspersorInicial),
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
      for (const s of o.sectores) {
        s.superficie ??= 0;
        // Obras de antes de la manguera: se agrega el tipo, pero cada aspersor queda con 0 m (como estaba calculado).
        s.manguera ??= 'pe-12';
        for (const a of s.aspersores) a.manguera ??= 0;
      }
    }
    return datos;
  }
  // Terreno del plano en metros. Las posiciones de aspersores y válvulas se guardan en cada sector.
  const planoNuevo = () => ({ ancho: 20, largo: 15, fuente: { x: 0.5, y: 0.5 }, distanciasDesdePlano: false, verCobertura: true });
  function guardar(datos) {
    try { localStorage.setItem(CLAVE, JSON.stringify(datos)); return true; } catch { return false; }
  }

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

  global.ALMACEN = { ESTADOS, cargar, guardar, obraNueva, sectorNuevo, aspersorInicial, nuevoId, hoy, exportar, importar };
})(typeof window !== 'undefined' ? window : globalThis);
