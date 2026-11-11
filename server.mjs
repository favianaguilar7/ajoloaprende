// Ajolo Publicador: panel local para elegir qué versión (C/D) de cada capítulo
// se publica en qué red, y enviarla a Upload-Post.
// Uso: node server.mjs  → http://localhost:3939
import http from 'node:http';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { createReadStream, openAsBlob, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { crearDrive } from './drive.mjs';
import { crearMetricool } from './metricool.mjs';

const run = promisify(execFile);
const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(
  process.env.CARPETA_VIDEOS ||
    path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/Ajololenguaje - videos terminados')
);
const ICLOUD = path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs');
const SALIDA = path.resolve(process.env.CARPETA_SALIDA || path.join(ICLOUD, 'salida'));
const PORT = Number(process.env.PORT || 3939);
const TZ = 'America/Mexico_City';
const API = 'https://api.upload-post.com/api';
const REDES = ['youtube', 'x', 'linkedin', 'tiktok', 'instagram'];
const CONFIG_FILE = path.join(DIR, 'config.json');
const HIST_FILE = path.join(DIR, 'historial.json');
const KC = ['-s', 'ajolo-publicador', '-a', 'upload-post'];

// ---------- utilidades ----------
const readJSON = async (f, def) => {
  try { return JSON.parse(await readFile(f, 'utf8')); } catch { return def; }
};
const writeJSON = (f, v) => writeFile(f, JSON.stringify(v, null, 2));
// Upload-Post devuelve resultados como lista o como objeto por red; se normaliza a lista
const lista = r => Array.isArray(r) ? r : r && typeof r === 'object'
  ? Object.entries(r).map(([platform, v]) => ({ platform, ...(v && typeof v === 'object' ? v : { status: String(v) }) }))
  : [];

async function getKey() {
  try { return (await run('security', ['find-generic-password', ...KC, '-w'])).stdout.trim() || null; }
  catch { return null; }
}
async function setKey(k) {
  await run('security', ['add-generic-password', '-U', ...KC, '-w', k]);
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
async function bodyJSON(req) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 1e6) throw new Error('Cuerpo demasiado grande'); }
  return s ? JSON.parse(s) : {};
}
// Evita salir de la carpeta de videos
function dentro(rel) {
  const abs = path.resolve(ROOT, rel);
  if (!abs.startsWith(ROOT + path.sep)) throw new Error('Ruta no permitida');
  return abs;
}

// ---------- lectura de la carpeta ----------
async function capitulos() {
  const ents = await readdir(ROOT, { withFileTypes: true });
  const dirs = ents.filter(e => e.isDirectory()).map(e => e.name)
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  const out = [];
  for (const d of dirs) {
    const m = d.normalize('NFC').match(/^(\d+)\s*-\s*(.+)$/);
    const versiones = {};
    for (const f of await readdir(path.join(ROOT, d))) {
      const v = f.normalize('NFC').match(/Version\s+([A-Z])\.(\w+)$/i);
      if (!v) continue;
      const L = v[1].toUpperCase(), ext = v[2].toLowerCase();
      const slot = (versiones[L] ||= {});
      const rel = path.join(d, f);
      if (['mp4', 'mov', 'm4v'].includes(ext)) slot.video = rel;
      else if (['jpg', 'jpeg', 'png'].includes(ext)) slot.portada = rel;
      else if (ext === 'txt') slot.texto = (await readFile(path.join(ROOT, rel), 'utf8')).trim();
    }
    out.push({ id: d, num: m ? Number(m[1]) : null, titulo: m ? m[2] : d, versiones });
  }
  return out;
}

// ---------- archivos (con soporte de Range para el reproductor) ----------
const MIME = { mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
async function media(req, res, rel) {
  const abs = dentro(rel);
  const { size } = await stat(abs);
  const type = MIME[path.extname(abs).slice(1).toLowerCase()] || 'application/octet-stream';
  const r = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (r) {
    const start = r[1] ? Number(r[1]) : size - Number(r[2]);
    const end = r[1] && r[2] ? Math.min(Number(r[2]), size - 1) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` });
    createReadStream(abs, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size });
    createReadStream(abs).pipe(res);
  }
}

// ---------- publicar ----------
async function publicar({ id, titulo, texto, asignacion, programar }) {
  const key = await getKey();
  const cfg = await readJSON(CONFIG_FILE, {});
  if (!key || !cfg.usuario) throw new Error('Falta configurar la API key o el usuario de Upload-Post.');
  const cap = (await capitulos()).find(c => c.id === id);
  if (!cap) throw new Error('Capítulo no encontrado: ' + id);
  texto = String(texto || '').trim();
  titulo = String(titulo || '').trim().slice(0, 100);
  if (!texto) throw new Error('El texto está vacío.');
  if (asignacion.youtube && !titulo) throw new Error('YouTube necesita un título.');
  if (asignacion.x && [...texto].length > 280) throw new Error('El texto pasa de 280 caracteres y no cabe en X.');

  // Agrupa redes por versión: una subida por versión
  const grupos = {};
  for (const red of REDES) {
    const v = asignacion[red];
    if (!v) continue;
    if (!cap.versiones[v]?.video) throw new Error(`No existe video de la versión ${v}.`);
    (grupos[v] ||= []).push(red);
  }
  if (!Object.keys(grupos).length) throw new Error('No elegiste ninguna red.');

  const hist = await readJSON(HIST_FILE, []);
  const resultados = [];
  for (const [v, redes] of Object.entries(grupos)) {
    const ver = cap.versiones[v];
    const fd = new FormData();
    fd.append('user', cfg.usuario);
    redes.forEach(r => fd.append('platform[]', r));
    fd.append('video', await openAsBlob(dentro(ver.video), { type: 'video/mp4' }), path.basename(ver.video));
    fd.append('title', texto);
    const portada = ver.portada ? async () => openAsBlob(dentro(ver.portada), { type: 'image/jpeg' }) : null;
    if (redes.includes('youtube')) {
      fd.append('youtube_title', titulo);
      fd.append('youtube_description', texto);
      fd.append('privacyStatus', 'public');
      if (portada) fd.append('thumbnail', await portada(), 'portada.jpg');
    }
    if (redes.includes('linkedin')) {
      fd.append('linkedin_title', titulo || texto.split('\n')[0].slice(0, 100));
      fd.append('linkedin_description', texto);
    }
    if (redes.includes('x')) fd.append('x_title', texto);
    if (redes.includes('tiktok')) {
      fd.append('tiktok_title', texto);
      fd.append('privacy_level', 'PUBLIC_TO_EVERYONE');
    }
    if (redes.includes('instagram')) {
      fd.append('instagram_title', texto);
      fd.append('media_type', 'REELS');
      if (portada) fd.append('cover_image', await portada(), 'portada.jpg');
    }
    if (programar) {
      fd.append('scheduled_date', programar.length === 16 ? programar + ':00' : programar);
      fd.append('timezone', TZ);
    } else {
      fd.append('async_upload', 'true');
    }

    const entrada = {
      id: randomUUID(), fecha: new Date().toISOString(), capitulo: id, num: cap.num,
      version: v, redes, programado: programar || null,
    };
    try {
      const r = await fetch(`${API}/upload`, {
        method: 'POST',
        headers: { Authorization: `Apikey ${key}`, 'Idempotency-Key': entrada.id },
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      entrada.ok = r.ok && j.success !== false;
      entrada.http = r.status;
      entrada.request_id = j.request_id || null;
      entrada.job_id = j.job_id || null;
      entrada.mensaje = j.message || j.error || null;
      entrada.estado = !entrada.ok ? 'error' : programar ? 'programado' : (j.results ? 'completed' : 'enviado');
      if (j.results) entrada.resultados = lista(j.results);
    } catch (e) {
      entrada.ok = false; entrada.estado = 'error'; entrada.mensaje = String(e.message || e);
    }
    hist.push(entrada);
    resultados.push(entrada);
  }
  await writeJSON(HIST_FILE, hist);
  return resultados;
}

async function estado(entradaId) {
  const key = await getKey();
  const hist = await readJSON(HIST_FILE, []);
  const e = hist.find(h => h.id === entradaId);
  if (!e) throw new Error('Entrada no encontrada');
  const q = e.request_id ? `request_id=${encodeURIComponent(e.request_id)}` : e.job_id ? `job_id=${encodeURIComponent(e.job_id)}` : null;
  if (!q) return e;
  const r = await fetch(`${API}/uploadposts/status?${q}`, { headers: { Authorization: `Apikey ${key}` } });
  const j = await r.json().catch(() => ({}));
  if (j.status) e.estado = j.status;
  if (j.results) e.resultados = lista(j.results);
  if (!r.ok && !j.status) e.mensaje = j.message || j.error || `HTTP ${r.status}`;
  e.actualizado = new Date().toISOString();
  await writeJSON(HIST_FILE, hist);
  return e;
}

// ---------- servidor ----------
// Carpetas que se pueden subir a Drive (pestaña "Subir a Drive", selector de carpeta)
const FUENTES = {
  ajolo: { nombre: 'Ajololenguaje - videos terminados', ROOT },
  salida: { nombre: 'salida (videos A/B)', ROOT: SALIDA },
};
const drives = Object.fromEntries(Object.entries(FUENTES).map(([id, f]) => [id, crearDrive({ ROOT: f.ROOT, readJSON, writeJSON, CONFIG_FILE })]));
async function rutasDrive(req, res, url, send) {
  if (req.method === 'GET' && url.pathname === '/api/drive/fuentes')
    return send(res, 200, Object.entries(FUENTES).map(([id, f]) => ({ id, nombre: f.nombre, carpeta: f.ROOT, existe: existsSync(f.ROOT), subiendo: drives[id].subiendo() }))), true;
  const d = drives[url.searchParams.get('fuente') || 'ajolo'];
  if (!d) return url.pathname.startsWith('/api/drive/') ? (send(res, 404, { error: 'Carpeta desconocida' }), true) : false;
  return d(req, res, url, send);
}
const rutasMetricool = crearMetricool({ ROOT: SALIDA, drive: drives.salida, readJSON, writeJSON, bodyJSON, DIR });
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (req.method === 'GET' && p === '/') return send(res, 200, await readFile(path.join(DIR, 'public/index.html')), 'text/html; charset=utf-8');
    if (req.method === 'GET' && p === '/drive') return send(res, 200, await readFile(path.join(DIR, 'public/drive.html')), 'text/html; charset=utf-8');
    if (req.method === 'GET' && p === '/metricool') return send(res, 200, await readFile(path.join(DIR, 'public/metricool.html')), 'text/html; charset=utf-8');
    if (await rutasDrive(req, res, url, send)) return;
    if (await rutasMetricool(req, res, url, send)) return;
    if (req.method === 'GET' && p === '/api/capitulos') return send(res, 200, { carpeta: ROOT, existe: existsSync(ROOT), capitulos: existsSync(ROOT) ? await capitulos() : [] });
    if (req.method === 'GET' && p === '/media') return await media(req, res, url.searchParams.get('f') || '');
    if (req.method === 'GET' && p === '/api/config') {
      const cfg = await readJSON(CONFIG_FILE, {});
      return send(res, 200, { usuario: cfg.usuario || '', tieneKey: !!(await getKey()) });
    }
    if (req.method === 'POST' && p === '/api/config') {
      const b = await bodyJSON(req);
      const cfg = await readJSON(CONFIG_FILE, {});
      if (typeof b.usuario === 'string') cfg.usuario = b.usuario.trim();
      await writeJSON(CONFIG_FILE, cfg);
      if (b.apiKey && b.apiKey.trim()) await setKey(b.apiKey.trim());
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && p === '/api/historial') return send(res, 200, await readJSON(HIST_FILE, []));
    if (req.method === 'POST' && p === '/api/publicar') return send(res, 200, await publicar(await bodyJSON(req)));
    if (req.method === 'POST' && p === '/api/estado') return send(res, 200, await estado((await bodyJSON(req)).id));
    send(res, 404, { error: 'No encontrado' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 400, { error: String(e.message || e) });
  }
});

// Solo accesible desde esta Mac
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Ajolo Publicador listo en http://localhost:${PORT}`);
  console.log(`Carpeta de videos: ${ROOT}`);
});
