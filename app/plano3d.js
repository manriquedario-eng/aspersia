// Vista 3D del plano: terreno (con la cobertura o el césped), cabezales, válvulas, fuente, caños y chorros de agua animados.
// Three.js va dentro de la app (app/vendor) y se carga recién la primera vez que se abre el 3D: funciona sin señal.
// Coordenadas del plano (x a la derecha, y hacia arriba) → Three.js: X = x - ancho/2, Z = largo/2 - y, Y hacia arriba.

(function (global) {
  const G = global.GEOMETRIA;
  const ALTURA_CABEZAL = 0.1;          // los cuerpos emergentes de 10 cm
  let cargando = null;
  let escena = null;                   // { renderer, scene, camera, controles, gotas, cuadro, observador, ... }

  function cargarScript(src) {
    return new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = () => mal(new Error('No se pudo cargar ' + src));
      document.head.appendChild(s);
    });
  }
  function cargarThree() {
    if (global.THREE && global.THREE.OrbitControls) return Promise.resolve();
    cargando ||= cargarScript('app/vendor/three-0.147.0.min.js').then(() => cargarScript('app/vendor/three-orbitcontrols-0.147.0.js'));
    return cargando;
  }
  const hayWebGL = () => {
    try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
  };

  // ---------- Suelo: césped con cuadrícula, o el mapa de cobertura del plano 2D ----------
  function texturaSuelo(T, terreno, aspersores, conCobertura) {
    const pxm = Math.min(40, 2048 / Math.max(terreno.ancho, terreno.largo));
    const c = document.createElement('canvas');
    c.width = Math.round(terreno.ancho * pxm); c.height = Math.round(terreno.largo * pxm);
    const g = c.getContext('2d');
    g.fillStyle = '#7fbf4d'; g.fillRect(0, 0, c.width, c.height);
    if (conCobertura && aspersores.length) {
      const cob = G.cobertura(terreno, aspersores, Math.max(0.1, Math.min(0.25, Math.max(terreno.ancho, terreno.largo) / 240)));
      const cw = c.width / cob.nx, ch = c.height / cob.ny;
      for (let j = 0; j < cob.ny; j++) for (let i = 0; i < cob.nx; i++) {
        const n = cob.cuenta[j * cob.nx + i];
        g.fillStyle = n === 0 ? 'rgba(225,29,72,.42)' : n === 1 ? 'rgba(234,179,8,.38)' : 'rgba(10,154,233,.16)';
        g.fillRect(i * cw, c.height - (j + 1) * ch, cw + 0.5, ch + 0.5);
      }
    }
    g.strokeStyle = 'rgba(255,255,255,.35)';
    for (let x = 1; x < terreno.ancho; x++) { g.lineWidth = x % 5 ? 1 : 2.5; g.beginPath(); g.moveTo(x * pxm, 0); g.lineTo(x * pxm, c.height); g.stroke(); }
    for (let y = 1; y < terreno.largo; y++) { g.lineWidth = y % 5 ? 1 : 2.5; g.beginPath(); g.moveTo(0, c.height - y * pxm); g.lineTo(c.width, c.height - y * pxm); g.stroke(); }
    const tex = new T.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  // Huella de lo que moja un aspersor, apoyada en el suelo (abanico o franja).
  function huella(T, a, aX, aZ, color) {
    const pts = [];
    const alto = 0.015;
    if (a.franja) {
      const g = a.giro * Math.PI / 180, W = a.ancho, L = a.radio;
      const vs = a.franja === 'SS' ? [-L / 2, L / 2] : a.franja === 'LCS' ? [-L, 0] : [0, L];
      const p = (u, v) => [a.x + u * Math.sin(g) + v * Math.cos(g), a.y + u * Math.cos(g) - v * Math.sin(g)];
      const q = [p(0, vs[0]), p(0, vs[1]), p(W, vs[1]), p(W, vs[0])].map(([x, y]) => [aX(x), alto, aZ(y)]);
      pts.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]);
    } else {
      const arco = Math.min(360, a.arco), n = Math.max(8, Math.round(arco / 6));
      const ini = a.arco >= 360 ? 0 : a.giro - arco / 2;
      for (let k = 0; k < n; k++) {
        const t1 = (ini + arco * k / n) * Math.PI / 180, t2 = (ini + arco * (k + 1) / n) * Math.PI / 180;
        pts.push(aX(a.x), alto, aZ(a.y),
          aX(a.x + a.radio * Math.sin(t1)), alto, aZ(a.y + a.radio * Math.cos(t1)),
          aX(a.x + a.radio * Math.sin(t2)), alto, aZ(a.y + a.radio * Math.cos(t2)));
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
    return new T.Mesh(geo, new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: T.DoubleSide, depthWrite: false }));
  }

  // ---------- Gotas: cada una sale del cabezal, sigue una parábola con la trayectoria de la boquilla y cae dentro del alcance ----------
  function armarGotas(T, aspersores, aX, aZ) {
    const gotas = [];
    for (const a of aspersores) {
      const area = a.franja ? a.ancho * a.radio : Math.PI * a.radio * a.radio * Math.min(360, a.arco) / 360;
      const n = Math.round(Math.min(260, Math.max(40, area * 9)));
      const tan = Math.tan((a.trayectoria || 0) * Math.PI / 180);
      for (let k = 0; k < n; k++) {
        let dx, dy;
        if (a.franja) {
          const g = a.giro * Math.PI / 180;
          const u = Math.random() * a.ancho;
          const v = a.franja === 'SS' ? (Math.random() - 0.5) * a.radio : (a.franja === 'LCS' ? -1 : 1) * Math.random() * a.radio;
          dx = u * Math.sin(g) + v * Math.cos(g); dy = u * Math.cos(g) - v * Math.sin(g);
        } else {
          const arco = Math.min(360, a.arco);
          const t = ((a.arco >= 360 ? 0 : a.giro - arco / 2) + Math.random() * arco) * Math.PI / 180;
          const d = a.radio * Math.sqrt(0.08 + 0.92 * Math.random());     // repartidas en el área, como cae el agua
          dx = d * Math.sin(t); dy = d * Math.cos(t);
        }
        const dist = Math.hypot(dx, dy);
        const alturaMax = Math.max(0.12, dist * tan / 4 + 0.04 * dist);
        gotas.push({ x0: aX(a.x), z0: aZ(a.y), dx, dz: -dy, alturaMax, fase: Math.random(), vel: 0.55 + Math.random() * 0.25 });
      }
    }
    const pos = new Float32Array(gotas.length * 3);
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    const puntos = new T.Points(geo, new T.PointsMaterial({ color: 0xd6f0ff, size: 4 * Math.min(2, global.devicePixelRatio || 1), sizeAttenuation: false, map: texturaGota(T), alphaTest: 0.05, transparent: true, opacity: 0.85, depthWrite: false }));
    return { gotas, pos, geo, puntos };
  }
  // Gota redonda y suave (en vez del cuadrado que dibuja WebGL por defecto)
  function texturaGota(T) {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(16, 16, 2, 16, 16, 15);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.5, 'rgba(255,255,255,.8)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.beginPath(); g.arc(16, 16, 15, 0, Math.PI * 2); g.fill();
    return new T.CanvasTexture(c);
  }
  function moverGotas(g, t) {
    for (let k = 0; k < g.gotas.length; k++) {
      const d = g.gotas[k];
      const s = (d.fase + t * d.vel) % 1;
      g.pos[k * 3] = d.x0 + d.dx * s;
      g.pos[k * 3 + 1] = ALTURA_CABEZAL + 4 * d.alturaMax * s * (1 - s);
      g.pos[k * 3 + 2] = d.z0 + d.dz * s;
    }
    g.geo.attributes.position.needsUpdate = true;
  }

  // ---------- Escena ----------
  async function abrir(contenedor, datos) {
    cerrar();
    if (!hayWebGL()) { contenedor.innerHTML = '<p class="ayuda">Este teléfono no puede mostrar 3D (no tiene WebGL).</p>'; return; }
    contenedor.innerHTML = '<p class="ayuda centro">Cargando 3D…</p>';
    await cargarThree();
    const T = global.THREE;
    contenedor.innerHTML = '';
    const { terreno, aspersores, sectores, fuente, colorSector, conCobertura } = datos;
    const aX = x => x - terreno.ancho / 2, aZ = y => terreno.largo / 2 - y;

    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, global.devicePixelRatio || 1));
    renderer.setClearColor(matchMedia('(prefers-color-scheme: dark)').matches ? 0x0d1520 : 0xdfeefa);
    contenedor.appendChild(renderer.domElement);
    const scene = new T.Scene();
    scene.add(new T.HemisphereLight(0xffffff, 0x557744, 0.95));
    const sol = new T.DirectionalLight(0xffffff, 0.6); sol.position.set(10, 20, 8); scene.add(sol);

    // Tierra alrededor y terreno
    const grande = Math.max(terreno.ancho, terreno.largo);
    const tierra = new T.Mesh(new T.PlaneGeometry(grande * 2.2, grande * 2.2), new T.MeshLambertMaterial({ color: 0x8f9c7a }));
    tierra.rotation.x = -Math.PI / 2; tierra.position.y = -0.02; scene.add(tierra);
    const suelo = new T.Mesh(new T.PlaneGeometry(terreno.ancho, terreno.largo), new T.MeshLambertMaterial({ map: texturaSuelo(T, terreno, aspersores, conCobertura) }));
    suelo.rotation.x = -Math.PI / 2; scene.add(suelo);

    // Huellas de riego (si no se muestra la cobertura) y cabezales
    for (const a of aspersores) {
      const color = new T.Color(colorSector(a.s));
      if (!conCobertura) scene.add(huella(T, a, aX, aZ, color));
      const cuerpo = new T.Mesh(new T.CylinderGeometry(0.09, 0.1, ALTURA_CABEZAL, 16), new T.MeshLambertMaterial({ color: 0x222831 }));
      cuerpo.position.set(aX(a.x), ALTURA_CABEZAL / 2, aZ(a.y)); scene.add(cuerpo);
      const tapa = new T.Mesh(new T.CylinderGeometry(0.16, 0.16, 0.04, 20), new T.MeshLambertMaterial({ color }));
      tapa.position.set(aX(a.x), ALTURA_CABEZAL + 0.02, aZ(a.y)); scene.add(tapa);
    }
    // Válvulas, fuente y caños (sobre el suelo, en el color del sector)
    sectores.forEach((s, k) => {
      if (!s.visible) return;
      const color = new T.Color(colorSector(k));
      const caja = new T.Mesh(new T.BoxGeometry(0.4, 0.18, 0.3), new T.MeshLambertMaterial({ color: 0x2f6b2a }));
      caja.position.set(aX(s.valvulaPos.x), 0.09, aZ(s.valvulaPos.y)); scene.add(caja);
      const tapa = new T.Mesh(new T.BoxGeometry(0.42, 0.02, 0.32), new T.MeshLambertMaterial({ color }));
      tapa.position.set(aX(s.valvulaPos.x), 0.19, aZ(s.valvulaPos.y)); scene.add(tapa);
      const puntos = [fuente, s.valvulaPos, ...s.aspersores].map(p => new T.Vector3(aX(p.x), 0.03, aZ(p.y)));
      const linea = new T.Line(new T.BufferGeometry().setFromPoints(puntos), new T.LineDashedMaterial({ color, dashSize: 0.4, gapSize: 0.25 }));
      linea.computeLineDistances(); scene.add(linea);
    });
    const bomba = new T.Mesh(new T.BoxGeometry(0.5, 0.4, 0.4), new T.MeshLambertMaterial({ color: 0x0b4a8f }));
    bomba.position.set(aX(fuente.x), 0.2, aZ(fuente.y)); scene.add(bomba);

    // Agua
    const gotas = armarGotas(T, aspersores, aX, aZ);
    scene.add(gotas.puntos);

    // Cámara y gestos: un dedo gira, dos dedos acercan y mueven
    const camera = new T.PerspectiveCamera(45, 1, 0.05, grande * 20);
    const controles = new T.OrbitControls(camera, renderer.domElement);
    controles.enableDamping = true;
    controles.maxPolarAngle = Math.PI / 2 - 0.04;
    controles.minDistance = 1;
    controles.maxDistance = grande * 5;
    controles.touches = { ONE: T.TOUCH.ROTATE, TWO: T.TOUCH.DOLLY_PAN };
    let tocado = false;
    controles.addEventListener('start', () => { tocado = true; });
    // Encuadre: que entre todo el terreno en la pantalla del teléfono (que es más alta que ancha), visto desde abajo y en diagonal.
    const encuadrar = () => {
      const mitad = Math.max(terreno.ancho / Math.max(camera.aspect, 0.3), terreno.largo) / 2;
      const dist = mitad / Math.tan(camera.fov * Math.PI / 360) * 1.3;
      camera.position.set(0, dist * 0.82, dist * 0.57);
      controles.target.set(0, 0, 0);
      controles.update();
    };
    const reencuadrar = () => { tocado = false; encuadrar(); };

    const medir = () => {
      const w = contenedor.clientWidth || 300, h = contenedor.clientHeight || 300;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
      camera.aspect = w / h; camera.updateProjectionMatrix();
      if (!tocado) encuadrar();          // mientras no la movió el usuario, se reencuadra con el tamaño real
    };
    medir();
    encuadrar();
    const observador = new ResizeObserver(medir);
    observador.observe(contenedor);

    escena = { renderer, scene, camera, controles, gotas, observador, agua: true, cuadro: 0, t0: performance.now(), encuadrar: reencuadrar };
    const dibujar = () => {
      if (!escena) return;
      escena.cuadro = requestAnimationFrame(dibujar);
      if (escena.agua) moverGotas(gotas, (performance.now() - escena.t0) / 1000);
      gotas.puntos.visible = escena.agua;
      controles.update();
      renderer.render(scene, camera);
    };
    moverGotas(gotas, 0);
    renderer.render(scene, camera);
    dibujar();
  }

  function cerrar() {
    if (!escena) return;
    cancelAnimationFrame(escena.cuadro);
    escena.observador.disconnect();
    escena.controles.dispose();
    escena.scene.traverse(o => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
    escena.renderer.dispose();
    escena.renderer.domElement.remove();
    escena = null;
  }

  global.PLANO3D = {
    abrir, cerrar,
    encuadrar: () => escena && escena.encuadrar(),
    alternarAgua: () => { if (escena) escena.agua = !escena.agua; return escena ? escena.agua : true; },
    abierto: () => !!escena,
  };
})(typeof window !== 'undefined' ? window : globalThis);
