// Arma la carpeta "publicar" con solo lo que necesita la app (sin catálogos, pruebas ni notas).
// Uso: node herramientas/armar-publicacion.mjs
// Lee la lista de archivos de sw.js, así lo que se publica es lo mismo que el teléfono guarda.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const destino = path.join(raiz, 'publicar');
const sw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
const lista = JSON.parse(sw.match(/const ARCHIVOS = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
const archivos = ['sw.js', ...lista.filter(a => a !== './')];

fs.rmSync(destino, { recursive: true, force: true });
let bytes = 0;
for (const a of archivos) {
  const origen = path.join(raiz, a);
  if (!fs.existsSync(origen)) throw new Error('Falta el archivo ' + a);
  fs.mkdirSync(path.dirname(path.join(destino, a)), { recursive: true });
  fs.copyFileSync(origen, path.join(destino, a));
  bytes += fs.statSync(origen).size;
}
console.log(`Carpeta "publicar" lista: ${archivos.length} archivos, ${(bytes / 1024).toFixed(0)} KB`);
