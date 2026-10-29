// Servidor local para probar la app en la computadora: node herramientas/servidor.mjs
// Sirve los archivos de la carpeta del proyecto en http://localhost:5173
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const puerto = Number(process.env.PORT) || 5173;
const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const archivo = path.join(raiz, ruta.endsWith('/') ? ruta + 'index.html' : ruta);
  if (!archivo.startsWith(raiz)) { res.writeHead(403).end(); return; }
  fs.readFile(archivo, (err, datos) => {
    if (err) { res.writeHead(404).end('No encontrado'); return; }
    res.writeHead(200, { 'Content-Type': (tipos[path.extname(archivo)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(datos);
  });
}).listen(puerto, () => console.log(`App de riego en http://localhost:${puerto}`));
