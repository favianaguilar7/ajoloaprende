// Subida de la carpeta de iCloud a Google Drive con rclone, con estado por archivo.
import { spawn, execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';

const run = promisify(execFile);
const RCLONE = path.join(os.homedir(), '.local/bin/rclone');
const REMOTE = 'gdrive';
const nfc = s => String(s).normalize('NFC');
const rclone = args => run(RCLONE, args, { maxBuffer: 64 << 20 });

export function crearDrive({ ROOT, readJSON, writeJSON, CONFIG_FILE }) {
  const DEST = path.basename(ROOT);           // misma carpeta en "Mi unidad"
  const s = {
    conexion: { estado: 'desconocido' },      // desconectado | conectando | conectado | error
    remotos: null,                            // Map ruta -> tamaño en Drive
    ids: new Map(),                           // Map ruta -> ID de archivo en Drive
    revisadoEn: null, revisando: null, errorRemoto: null,
    proc: null, run: null,
  };

  // ---------- conexión ----------
  async function revisarConexion() {
    if (s.conexion.estado === 'conectando') return;
    try {
      const { stdout } = await rclone(['listremotes']);
      const ok = stdout.split('\n').map(x => x.trim()).includes(REMOTE + ':');
      s.conexion = ok ? { estado: 'conectado' } : { estado: 'desconectado' };
    } catch (e) {
      s.conexion = { estado: 'error', error: 'No se pudo ejecutar rclone: ' + (e.message || e) };
    }
  }

  function conectar() {
    if (s.conexion.estado === 'conectando') return;
    s.conexion = { estado: 'conectando', url: null };
    // scope drive.file: rclone solo ve y toca los archivos que él mismo sube
    const p = spawn(RCLONE, ['config', 'create', REMOTE, 'drive', 'scope=drive.file'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const onData = d => {
      out += d;
      const m = out.match(/http:\/\/127\.0\.0\.1:53682\/auth\?state=[^\s"]+/);
      if (m) s.conexion.url = m[0];
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    const limite = setTimeout(() => p.kill('SIGTERM'), 5 * 60 * 1000);
    p.on('close', code => {
      clearTimeout(limite);
      if (code === 0) { s.conexion = { estado: 'conectado' }; s.remotos = null; revisarRemoto(); }
      else s.conexion = { estado: 'error', error: 'No se completó la autorización. ' + out.trim().split('\n').slice(-2).join(' ').slice(0, 300) };
    });
  }

  // ---------- qué hay en Drive ----------
  function revisarRemoto() {
    if (s.revisando) return s.revisando;
    s.revisando = (async () => {
      try {
        const { stdout } = await rclone(['lsjson', '-R', '--files-only', '--no-mimetype', '--no-modtime', `${REMOTE}:${DEST}`]);
        const m = new Map(), ids = new Map();
        for (const f of JSON.parse(stdout)) { m.set(nfc(f.Path), f.Size); ids.set(nfc(f.Path), f.ID); }
        s.remotos = m; s.ids = ids; s.errorRemoto = null;
      } catch (e) {
        const txt = String(e.stderr || e.message || e);
        if (/directory not found/i.test(txt)) { s.remotos = new Map(); s.ids = new Map(); s.errorRemoto = null; }
        else s.errorRemoto = txt.trim().split('\n').slice(-1)[0].slice(0, 300);
      }
      s.revisadoEn = new Date().toISOString();
      s.revisando = null;
    })();
    return s.revisando;
  }

  // ---------- qué hay en iCloud ----------
  async function locales() {
    const out = [];
    async function walk(rel) {
      for (const e of await readdir(path.join(ROOT, rel), { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'Icon\r') continue;
        const r = rel ? path.join(rel, e.name) : e.name;
        if (e.isDirectory()) await walk(r);
        else if (e.isFile()) out.push({ path: nfc(r), size: (await stat(path.join(ROOT, r))).size });
      }
    }
    await walk('');
    return out.sort((a, b) => a.path.localeCompare(b.path, 'es', { numeric: true }));
  }

  // ---------- subir ----------
  function subir() {
    if (s.proc) return;
    if (s.conexion.estado !== 'conectado') throw new Error('Primero conecta Google Drive.');
    const r = s.run = { inicio: Date.now(), fin: null, estado: 'subiendo', stats: null, transferring: [], errores: [], subidos: 0, cancelado: false };
    const p = s.proc = spawn(RCLONE, [
      'copy', ROOT, `${REMOTE}:${DEST}`,
      '--use-json-log', '--stats', '1s', '--stats-log-level', 'NOTICE', '-v',
      '--transfers', '3', '--drive-chunk-size', '32M', '--retries', '3',
      '--exclude', '.*', '--exclude', 'Icon\r',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    const onData = d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { linea(r, buf.slice(0, i)); buf = buf.slice(i + 1); }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('close', async code => {
      r.fin = Date.now();
      r.estado = r.cancelado ? 'detenido' : code === 0 ? 'terminado' : 'con errores';
      r.transferring = [];
      s.proc = null;
      const secs = (r.fin - r.inicio) / 1000;
      if (r.stats?.bytes > 20e6 && secs > 5) {           // recuerda la velocidad para estimar la próxima vez
        const cfg = await readJSON(CONFIG_FILE, {});
        cfg.velocidadDrive = r.stats.bytes / secs;
        await writeJSON(CONFIG_FILE, cfg);
      }
      await revisarRemoto();
    });
  }

  function linea(r, l) {
    let j;
    try { j = JSON.parse(l); } catch { return; }
    if (j.stats) { r.stats = j.stats; r.transferring = j.stats.transferring || []; }
    if (/^Copied/.test(j.msg || '') && j.object) {
      r.subidos++;
      s.remotos?.set(nfc(j.object), j.size);
      r.errores = r.errores.filter(e => e.object !== nfc(j.object));
    }
    if (j.level === 'error') r.errores.push({ object: j.object ? nfc(j.object) : null, msg: String(j.msg || '').trim() });
  }

  // ---------- eliminar de Drive (van a la papelera de Drive) ----------
  async function eliminar(rutas) {
    if (s.proc) throw new Error('Espera a que termine la subida.');
    if (!s.remotos) await revisarRemoto();
    const lista = [...new Set(rutas.map(nfc))].filter(r => s.remotos?.has(r));   // solo lo que está en Drive
    const fallos = [];
    let i = 0;
    const trabajador = async () => {
      while (i < lista.length) {
        const r = lista[i++];
        try { await rclone(['deletefile', `${REMOTE}:${DEST}/${r}`]); s.remotos.delete(r); }
        catch (e) { fallos.push({ path: r, error: String(e.stderr || e.message).trim().split('\n').slice(-1)[0].slice(0, 200) }); }
      }
    };
    await Promise.all([1, 2, 3, 4].map(trabajador));
    return { eliminados: lista.length - fallos.length, fallos };
  }

  function detener() {
    if (!s.proc) return;
    s.run.cancelado = true;
    s.proc.kill('SIGTERM');
  }

  // ---------- estado para la página ----------
  async function estado() {
    await revisarConexion();
    if (s.conexion.estado === 'conectado' && !s.remotos && !s.proc) await revisarRemoto();
    const cfg = await readJSON(CONFIG_FILE, {});
    const r = s.run;
    const enCurso = new Map((s.proc ? r.transferring : []).map(t => [nfc(t.name), t]));
    const errores = new Map((r?.errores || []).filter(e => e.object).map(e => [e.object, e.msg]));

    const archivos = (await locales()).map(f => {
      const t = enCurso.get(f.path);
      const enDrive = s.remotos?.get(f.path);
      const estado = enDrive === f.size ? 'subido'
        : t ? 'subiendo'
        : errores.has(f.path) ? 'error'
        : 'pendiente';
      return {
        ...f, estado,
        distinto: enDrive != null && enDrive !== f.size,    // existe en Drive pero con otro tamaño: se reemplaza
        bytes: estado === 'subido' ? f.size : t?.bytes || 0,
        pct: t ? t.percentage : estado === 'subido' ? 100 : 0,
        speed: t?.speed || null, eta: t?.eta ?? null,
        error: estado === 'error' ? errores.get(f.path) : null,
      };
    });

    const tot = { archivos: archivos.length, bytes: 0, hechos: 0, subidos: 0, subiendo: 0, pendientes: 0, errores: 0 };
    for (const a of archivos) {
      tot.bytes += a.size; tot.hechos += a.bytes;
      tot[{ subido: 'subidos', subiendo: 'subiendo', pendiente: 'pendientes', error: 'errores' }[a.estado]]++;
    }
    const restante = tot.bytes - tot.hechos;
    const vel = s.proc && r.stats?.speed > 0 ? r.stats.speed : null;
    const eta = restante <= 0 ? 0 : vel ? restante / vel : cfg.velocidadDrive ? restante / cfg.velocidadDrive : null;

    return {
      conexion: s.conexion,
      destino: `Mi unidad/${DEST}`,
      revisadoEn: s.revisadoEn, revisando: !!s.revisando, errorRemoto: s.errorRemoto,
      corriendo: !!s.proc,
      run: r && { inicio: r.inicio, fin: r.fin, estado: r.estado, subidos: r.subidos, errores: r.errores.slice(-10) },
      velocidad: vel,
      eta, etaFuente: restante <= 0 ? 'listo' : vel ? 'actual' : cfg.velocidadDrive ? 'anterior' : null,
      totales: tot, archivos,
    };
  }

  // ---------- rutas ----------
  // ---------- para otros módulos (Metricool) ----------
  // Archivos en Drive: ruta -> { size, id }. Revisa Drive si aún no se ha hecho.
  async function enDrive({ refrescar = false } = {}) {
    await revisarConexion();
    if (s.conexion.estado !== 'conectado') return null;
    if (refrescar || !s.remotos || [...s.remotos.keys()].some(r => !s.ids.has(r))) await revisarRemoto();
    const m = new Map();
    for (const [r, size] of s.remotos || []) m.set(r, { size, id: s.ids.get(r) });
    return m;
  }
  // "Cualquiera con el enlace puede ver": lo que pide Metricool para descargar el video
  async function compartir(ruta) {
    await rclone(['link', `${REMOTE}:${DEST}/${ruta}`]);
  }

  rutas.enDrive = enDrive;
  rutas.compartir = compartir;
  rutas.subiendo = () => !!s.proc;
  return rutas;

  async function rutas(req, res, url, send) {
    const p = url.pathname;
    if (!p.startsWith('/api/drive/')) return false;
    if (req.method === 'GET' && p === '/api/drive/estado') { send(res, 200, await estado()); return true; }
    if (req.method === 'POST' && p === '/api/drive/conectar') { conectar(); send(res, 200, { ok: true }); return true; }
    if (req.method === 'POST' && p === '/api/drive/subir') { await revisarConexion(); subir(); send(res, 200, { ok: true }); return true; }
    if (req.method === 'POST' && p === '/api/drive/detener') { detener(); send(res, 200, { ok: true }); return true; }
    if (req.method === 'POST' && p === '/api/drive/eliminar') {
      let body = '';
      for await (const c of req) { body += c; if (body.length > 1e6) break; }
      let rutas;
      try { rutas = JSON.parse(body).rutas; } catch { rutas = null; }
      if (!Array.isArray(rutas) || !rutas.every(r => typeof r === 'string')) { send(res, 400, { error: 'Petición inválida.' }); return true; }
      try { send(res, 200, await eliminar(rutas)); } catch (e) { send(res, 409, { error: e.message }); }
      return true;
    }
    if (req.method === 'POST' && p === '/api/drive/revisar') { if (!s.proc) await revisarRemoto(); send(res, 200, { ok: true }); return true; }
    return false;
  }
}
