// Programación de la carpeta "salida" (videos A/B) para Metricool: plan semanal escalonado
// por red, textos armados a partir de caption.txt, CSV de importación y registro de lo programado.
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const nfc = s => String(s).normalize('NFC');
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// Redes: id -> columna en el CSV de Metricool
export const REDES = {
  instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok', x: 'Twitter/X',
  linkedin: 'LinkedIn', facebook: 'Facebook', threads: 'Threads',
};
const COLS_RED = ['Facebook', 'Twitter/X', 'LinkedIn', 'GBP', 'Instagram', 'Pinterest', 'TikTok', 'YouTube', 'Threads', 'Bluesky'];
const r = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));
// Respaldo si no existe metricool/plantilla.csv (la plantilla oficial manda)
const ENCABEZADOS = [
  'Text', 'Date', 'Time', 'Draft', ...COLS_RED,
  ...r(10, i => `Picture Url ${i}`), ...r(10, i => `Alt text picture ${i}`),
  'Document title', 'Shortener', 'Video Thumbnail Url', 'Video Cover Frame',
  'Instagram Post Type', 'Instagram Show Reel On Feed',
  'YouTube Video Title', 'YouTube Video Type', 'YouTube Video Privacy', 'YouTube video for kids',
  'YouTube AI generated content', 'YouTube notify subscribers', 'YouTube Video Category', 'YouTube Video Tags',
  'TikTok disable comments', 'TikTok disable duet', 'TikTok disable stitch', 'TikTok AI generated content', 'Brand name',
];

// Mejores horas por red (hora de Ciudad de México), según los estudios generales de 2026:
// Reels/TikTok/Shorts rinden en la tarde-noche, X en la mañana, LinkedIn en horario laboral.
// En Metricool, "Best times" muestra las de tu propia cuenta: conviene compararlas.
const HORAS_BASE = {
  instagram: ['12:00', '18:00', '21:00'],
  tiktok: ['13:00', '19:00', '22:00'],
  youtube: ['14:00', '17:00', '20:00'],
  x: ['09:00', '12:00', '18:00'],
  linkedin: ['08:30', '12:30', '17:00'],
  facebook: ['09:00', '13:00', '19:00'],
  threads: ['10:00', '14:00', '20:00'],
};

// ---------- fechas (hora local de la Mac) ----------
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const deISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const masDias = (s, n) => { const d = deISO(s); d.setDate(d.getDate() + n); return iso(d); };

function configBase() {
  return {
    desde: null, hasta: null,    // null = automático: la semana siguiente a lo ya programado
    porDia: 3,                   // videos al día en cada red
    horas: structuredClone(HORAS_BASE),
    // Grupo de escalonado por red (0 = no publicar). Con 2 grupos, el día que el grupo 1
    // publica los videos 1-3, el grupo 2 publica los 4-6, y al día siguiente se invierten.
    redes: { instagram: 1, facebook: 1, youtube: 2, tiktok: 2, x: 0, linkedin: 0, threads: 0 },
    diasA: [5],                  // viernes: versiones A de los videos marcados como estancados
    detalle: true,               // incluir la línea de técnicas ("JWT, command injection…")
    hashtags: '#hacking #ciberseguridad #ctf',
    hashtagsTema: true,          // hashtags según la descripción (#SQLInjection, #SUID…)
    hashtagMaquina: true,        // añade #NombreDeLaMaquina
    youtubeTipo: 'SHORT',
    youtubeCategoria: 'SCIENCE_TECHNOLOGY',
    contenidoIA: false,
    primeraHoy: null,            // { fecha, hora }: primera publicación de ese día a esa hora
  };
}

// ---------- hashtags según lo que cuenta cada descripción ----------
// [expresión que se busca en gancho + resumen, hashtag]. El orden es la prioridad.
const TEMAS = [
  [/\bSQLi\b|\bSQL\b|comilla|'--/i, '#SQLInjection'],
  [/\bLFI\b|\binclude\b/i, '#LFI'],
  [/command injection|inyecci[oó]n de comandos|punto y coma|ejecuta comandos|ejecuci[oó]n remota|\bRCE\b|webshell|reverse shell/i, '#RCE'],
  [/\bJWT\b|cookie/i, '#JWT'],
  [/\bIDOR\b|cambiar el id/i, '#IDOR'],
  [/esteganograf|una foto|una imagen|la imagen llevaba/i, '#Esteganografia'],
  [/subi[oó] un archivo|subida|cargador de im[aá]genes|\.phar|shell\.php|\bWAR\b/i, '#FileUpload'],
  [/\bSUID\b|\bla [`]?s[`]? que faltaba|una sola «s»|cap_setuid|capability/i, '#SUID'],
  [/\bsudo\b|privilegio|escalada|uid=0|euid|UID 0/i, '#PrivEsc'],
  [/\bcron\b|tarea (de root )?editable|cada cinco segundos/i, '#Cron'],
  [/biblioteca falsa|biblioteca equivocada|\bPATH\b|su biblioteca/i, '#PathHijacking'],
  [/diccionario|fuerza bruta|Hydra|RockYou|wordlist|contrase[ñn]a (débil|trivial)|clave débil|password1/i, '#FuerzaBruta'],
  [/Base64|C[eé]sar|ROT13|SHA-256|cifra|Brainfuck/i, '#Criptografia'],
  [/filtro de URLs|redirig|enlace empieza/i, '#OpenRedirect'],
  [/puerta trasera|backdoor|una carita|sonrisa en el usuario/i, '#Backdoor'],
  [/identidades|la foto daba el usuario|informaci[oó]n p[uú]blica|OSINT/i, '#OSINT'],
  [/\bSSH\b|llave privada/i, '#SSH'],
  [/\bFTP\b|vsftpd/i, '#FTP'],
  [/Drupal/i, '#Drupal'],
  [/WordPress|plugin|\bCMS\b/i, '#WordPress'],
  [/Python|pip\b|\.pyc|setup\.py/i, '#Python'],
  [/\bPHP\b|\.php/i, '#PHP'],
  [/PCAP|la red grab[oó]/i, '#Forense'],
  [/desbordamiento|retorno de un programa|binario/i, '#ReversingYExploiting'],
  [/EternalBlue|Windows|\b445\b/i, '#Windows'],
  [/t[uú]nel|cinco redes|pivot/i, '#Pivoting'],
  [/Tomcat|Jenkins|Grafana|Apache|Flask|Node|React|blog|\bweb\b|respaldo p[uú]blico|ZIP|comentario|dominios/i, '#Web'],
  [/contrase[ñn]a reutilizada|misma contrase[ñn]a/i, '#Contraseñas'],
  [/editable|permiso|root/i, '#PrivEsc'],   // casi todos llegan a root: respaldo
];
export function hashtagsTema(texto, max = 4) {
  const vistos = new Set(), out = [];
  for (const [re, tag] of TEMAS) {
    if (out.length >= max) break;
    if (re.test(texto) && !vistos.has(tag)) { vistos.add(tag); out.push(tag); }
  }
  return out;
}

// ---------- textos a partir de caption.txt ----------
// caption.txt: línea 1 = gancho; línea 2 = resumen + ruta interna "piloto/docker/NN-Nombre/writeup.md"
export function analizarCaption(raw, slug, dificultad) {
  const lineas = nfc(raw).trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const gancho = lineas[0] || '';
  const resto = lineas.slice(1).join(' ');
  // nombre de la máquina: de la ruta, con la escritura (mayúsculas) que use el texto
  const ruta = resto.match(/piloto\/[^/\s`]+\/\d+-([^/\s`]+)\//);
  let maquina = ruta ? ruta[1] : slug.split('-')[0];
  const enTexto = (gancho + ' ' + resto).match(new RegExp(`\\b${maquina.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));
  if (enTexto && enTexto[0] !== enTexto[0].toLowerCase()) maquina = enTexto[0];
  else if (maquina === maquina.toLowerCase()) maquina = maquina[0].toUpperCase() + maquina.slice(1);

  // resumen sin la ruta interna
  let detalle = '';
  const g = resto.match(/Gu[ií]a completa de [^,]+, con (.+?)(?::\s*piloto\/\S+)?$/i);
  if (g) detalle = `${maquina}: ${g[1].replace(/\s*y defensa\.?$/i, ' y cómo defenderte')}.`;
  else {
    detalle = resto
      .split(/(?<=\.)\s+/)
      .filter(s => !/piloto\//.test(s) && !/^(el )?writeup completo/i.test(s) && !/writeup( completo)? del proyecto|en el writeup\.?$/i.test(s))
      .join(' ')
      .replace(/[.\s]*(Writeup completo|Guía completa)[^.]*piloto\/\S+/gi, '.')
      .replace(/:\s*piloto\/\S+/g, '')
      .trim();
    if (/^(Writeup completo|Guía completa)/i.test(detalle)) detalle = '';
  }
  detalle = detalle.replace(/`/g, '').replace(/\.\.$/, '.').trim();
  // nombre completo si el resumen empieza con él ("Los 3 Hackers:", "Hannah Coffee:")
  const solo = x => x.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const pre = detalle.match(/^([^:,.]{2,30})[:,]/);
  if (pre && solo(pre[1]).startsWith(solo(maquina)) && pre[1].split(/\s+/).length <= 4) maquina = pre[1].trim();
  if (g) detalle = detalle.replace(/^[^:]+:/, maquina + ':');
  // técnicas (para etiquetas de YouTube): lo enumerado tras "Nombre:" o "con …"
  const lista = (g ? g[1] : (detalle.split(/:\s/)[1] || ''))
    .replace(/\s*(y|hasta) (defensa|root|cómo defenderte).*$/i, '')
    .split(/,\s*|\s+y\s+|\s*→\s*/)
    .map(t => t.replace(/[.`]/g, '').trim())
    .filter(t => t && t.length <= 25 && t.split(/\s+/).length <= 3 && !/root|perfil/i.test(t)
      && !/^(de|a|un|una|el|la|las|los|y|con|cómo|así|está|se|cada|su|acceso|protege)(?=\s|$)/i.test(t));
  return { gancho, detalle, maquina, dificultad, tecnicas: [...new Set(lista)].slice(0, 8), temas: hashtagsTema(gancho + ' ' + resto.replace(/piloto\/\S+/g, '')) };
}

function armarTexto(c, cfg, { max } = {}) {
  const tagMaq = cfg.hashtagMaquina ? '#' + c.maquina.replace(/[^\p{L}\p{N}_]/gu, '') : '';
  const tags = [...new Set([...(cfg.hashtagsTema ? c.temas : []), tagMaq, ...cfg.hashtags.trim().split(/\s+/)].filter(Boolean))].join(' ');
  const pie = `Máquina ${c.maquina}${c.dificultad ? ' · nivel ' + c.dificultad : ''}`;
  const variantes = [
    [c.gancho, cfg.detalle && c.detalle, '', pie, tags],
    [c.gancho, '', pie, tags],
    [c.gancho, '', tags],
    [c.gancho],
  ];
  for (const v of variantes) {
    const t = v.filter(x => x !== false && x != null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!max || t.length <= max) return t;
  }
  return c.gancho.slice(0, max);
}

function tituloYT(c) {
  const base = `${c.maquina}${c.dificultad ? ` (${c.dificultad})` : ''} | `;
  let t = base + c.gancho;
  if (t.length > 100) t = t.slice(0, 99).replace(/\s+\S*$/, '') + '…';
  return t;
}
const tagsYT = c => [...new Set([c.maquina, 'CTF', 'hacking ético', 'ciberseguridad', 'pentesting', 'writeup', 'DockerLabs', c.dificultad && 'CTF ' + c.dificultad, ...c.temas.map(t => t.slice(1)), ...c.tecnicas].filter(Boolean))].join(',').slice(0, 480);

export function crearMetricool({ ROOT, drive, readJSON, writeJSON, bodyJSON, DIR }) {
  const FILE = path.join(DIR, 'metricool.json');
  const CSV_DIR = path.join(DIR, 'metricool', 'csv');
  const PLANTILLA = path.join(DIR, 'metricool', 'plantilla.csv');
  const leer = async () => {
    const d = await readJSON(FILE, {});
    const base = configBase(), c = { ...base, ...(d.config || {}) };
    c.horas = { ...base.horas, ...(d.config?.horas && !Array.isArray(d.config.horas) ? d.config.horas : {}) };
    for (const k of ['quitarWriteup']) delete c[k];   // opciones viejas
    return { config: c, estancados: d.estancados || [], lotes: d.lotes || [] };
  };
  const guardar = async d => writeJSON(FILE, { config: d.config, estancados: d.estancados, lotes: d.lotes });
  let trabajo = null;           // generación en curso { hechos, total, error }

  // ---------- videos de la carpeta ----------
  async function pares() {
    if (!existsSync(ROOT)) return [];
    const m = new Map();
    for (const e of await readdir(ROOT, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const dir = nfc(e.name);
      const fm = dir.match(/^(\d{4}-\d{2}-\d{2})-(.+?)(-b)?$/);
      if (!fm) continue;
      const [, fecha, slug, b] = fm;
      const dif = slug.match(/-(muy-facil|facil|medio|media|dificil|muy-dificil)$/);
      const p = m.get(slug) || { key: slug, nombre: dif ? slug.slice(0, -dif[0].length) : slug, dificultad: dif ? dif[1].replace('-', ' ').replace('facil', 'fácil').replace('dificil', 'difícil') : '', fecha };
      const archivos = (await readdir(path.join(ROOT, dir))).map(nfc).filter(f => !f.startsWith('.'));
      p[b ? 'B' : 'A'] = {
        dir, fecha,
        video: archivos.find(f => /\.(mp4|mov)$/i.test(f)) || null,
        portada: archivos.find(f => /^portada\.(jpe?g|png)$/i.test(f)) || null,
      };
      if (fecha < p.fecha) p.fecha = fecha;
      m.set(slug, p);
    }
    return [...m.values()].sort((a, b) => (a.B?.fecha || a.fecha).localeCompare(b.B?.fecha || b.fecha) || a.key.localeCompare(b.key));
  }

  const cacheTxt = new Map();
  async function caption(p, version) {
    const v = p[version];
    const f = path.join(ROOT, v.dir, 'caption.txt');
    const st = await stat(f).catch(() => null);
    if (!st) return analizarCaption(p.nombre, p.key, p.dificultad);
    const k = f + st.mtimeMs;
    if (!cacheTxt.has(k)) cacheTxt.set(k, analizarCaption(await readFile(f, 'utf8'), p.key, p.dificultad));
    return cacheTxt.get(k);
  }
  const maxTexto = redes => redes.includes('x') ? 280 : redes.includes('tiktok') ? 2200 : null;

  // horas de una red para una fecha; si la fecha es hoy, solo las que faltan (margen de 30 min para importar)
  const MARGEN_MIN = 30;
  function horasLibres(cfg, red, fecha) {
    const hs = (cfg.horas[red] || HORAS_BASE[red]).slice(0, cfg.porDia);
    while (hs.length < cfg.porDia) hs.push(HORAS_BASE[red][hs.length % 3]);
    // primera hora fija para un día (p. ej. hoy a las 13:00): esa hora y después las mejores horas que siguen
    const fija = cfg.primeraHoy?.fecha === fecha && /^\d{2}:\d{2}$/.test(cfg.primeraHoy.hora) ? cfg.primeraHoy.hora : null;
    if (fija) {
      const min = h => +h.slice(0, 2) * 60 + +h.slice(3);
      const lista = [fija, ...hs.filter(h => h > fija)];
      while (lista.length < cfg.porDia) {          // rellena con el punto medio del hueco más grande
        let mejor = 0;
        for (let i = 1; i < lista.length; i++) if (min(lista[i]) - min(lista[i - 1]) > min(lista[mejor + 1] || '23:59') - min(lista[mejor])) mejor = i - 1;
        const a = min(lista[mejor]), b = min(lista[mejor + 1] || '23:00'), m = Math.round((a + b) / 2 / 30) * 30;
        if (m <= a || m >= b) break;
        lista.splice(mejor + 1, 0, String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));
      }
      hs.splice(0, hs.length, ...lista.slice(0, cfg.porDia));
    }
    if (fecha !== iso(new Date())) return hs;
    const t = new Date(Date.now() + (fija ? 0 : MARGEN_MIN) * 60000);
    const ya = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    return t.getDate() === new Date().getDate() ? hs.filter(h => h > ya) : [];
  }

  // ---------- fechas automáticas: la semana siguiente a lo ya programado ----------
  function fechas(cfg, d) {
    // empieza hoy si a alguna red activa todavía le queda una hora libre (con margen); si no, mañana
    const hoyF = iso(new Date());
    const quedaHoy = Object.entries(cfg.redes).some(([red, g]) => g > 0 && horasLibres(cfg, red, hoyF).length);
    const primero = quedaHoy ? hoyF : masDias(hoyF, 1);
    let ultimo = null;
    for (const l of d.lotes) for (const it of l.items) if (!ultimo || it.fecha > ultimo) ultimo = it.fecha;
    const desde = cfg.desde || (ultimo && masDias(ultimo, 1) > primero ? masDias(ultimo, 1) : primero);
    const hasta = cfg.desde && cfg.hasta ? cfg.hasta : masDias(desde, 6);
    return { desde, hasta: hasta < desde ? desde : hasta, auto: !cfg.desde };
  }

  // ---------- plan ----------
  // Cada red lleva su propia cola de videos B. Cada día, cada grupo de redes publica primero
  // los videos que otro grupo ya sacó (los "pendientes" en ese grupo) y después videos nuevos
  // que ningún otro grupo esté publicando ese día. Así el escalonado sigue entre semanas.
  function planificar(cfg, lista, d) {
    const avisos = [];
    const { desde, hasta } = fechas(cfg, d);
    const redes = Object.entries(cfg.redes).filter(([, g]) => g > 0);
    const grupos = [...new Set(redes.map(([, g]) => g))].sort();
    const N = cfg.porDia;
    if (!redes.length) avisos.push('No hay ninguna red activada.');

    // estado previo: en qué grupos ya está programado cada video (por versión)
    const enGrupo = new Map();      // `${key}|${version}` -> Set(grupo)
    const inicio = new Map();       // `${key}|${version}` -> primera fecha programada
    const marcar = (k, g, f) => {
      (enGrupo.get(k) || enGrupo.set(k, new Set()).get(k)).add(g);
      if (!inicio.has(k) || f < inicio.get(k)) inicio.set(k, f);
    };
    for (const l of d.lotes) for (const it of l.items) for (const red of it.redes) {
      const g = cfg.redes[red] || 0; if (g) marcar(it.key + '|' + it.version, g, it.fecha);
    }
    const yaA = new Set(d.lotes.flatMap(l => l.items.filter(i => i.version === 'A').map(i => i.key)));
    const colaA = lista.filter(p => d.estancados.includes(p.key) && p.A?.video && !yaA.has(p.key));
    const conB = lista.filter(p => p.B?.video);

    const items = [];
    // cuántos videos caben hoy en un grupo: lo que le quede a la red del grupo con menos horas libres
    const cupo = (fecha, gr) => Math.min(N, ...redes.filter(([, g]) => g === gr).map(([red]) => horasLibres(cfg, red, fecha).length));
    const poner = (fecha, idx, p, version, gr) => {
      for (const [red, g] of redes) {
        if (g !== gr) continue;
        const libres = horasLibres(cfg, red, fecha);
        const hora = libres[libres.length - cupo(fecha, gr) + idx];
        let it = items.find(x => x.fecha === fecha && x.hora === hora && x.key === p.key && x.version === version);
        if (!it) items.push(it = { fecha, hora, key: p.key, version, redes: [] });
        it.redes.push(red);
      }
    };

    for (let f = desde; f <= hasta; f = masDias(f, 1)) {
      if (cfg.diasA.includes(deISO(f).getDay()) && colaA.length) {
        const nA = Math.min(...grupos.map(g => cupo(f, g)));
        if (nA > 0) { colaA.splice(0, nA).forEach((p, i) => grupos.forEach(g => poner(f, i, p, 'A', g))); continue; }
      }
      const hoy = new Set();
      for (const g of grupos) {
        const k = p => p.key + '|B';
        const falta = conB.filter(p => !enGrupo.get(k(p))?.has(g) && !hoy.has(p.key));
        const atrasados = falta.filter(p => enGrupo.has(k(p))).sort((a, b) => inicio.get(k(a)).localeCompare(inicio.get(k(b))));
        const nuevos = falta.filter(p => !enGrupo.has(k(p)));
        [...atrasados, ...nuevos].slice(0, cupo(f, g)).forEach((p, i) => { hoy.add(p.key); poner(f, i, p, 'B', g); });
      }
      for (const key of hoy) for (const g of grupos) if (items.some(it => it.fecha === f && it.key === key && it.redes.some(r => cfg.redes[r] === g))) marcar(key + '|B', g, f);
    }
    const sinNada = conB.filter(p => !enGrupo.has(p.key + '|B')).length;
    if (!items.length) avisos.push('Ya no quedan versiones B sin programar.');
    const orden = Object.keys(REDES);
    for (const it of items) it.redes.sort((a, b) => orden.indexOf(a) - orden.indexOf(b));
    items.sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora) || a.key.localeCompare(b.key));
    return { items, avisos, desde, hasta, sinProgramarB: sinNada };
  }

  async function estado() {
    const t0 = trabajo && { ...trabajo };
    const d = await leer();
    const cfg = d.config;
    const lista = await pares();
    const remotos = await drive.enDrive().catch(() => null);
    const plan = planificar(cfg, lista, d);
    const porKey = new Map(lista.map(p => [p.key, p]));
    const ahora = new Date();
    const yaPaso = it => new Date(`${it.fecha}T${it.hora}:00`) <= ahora;

    const faltan = new Set();
    for (const it of plan.items) {
      const p = porKey.get(it.key), v = p[it.version];
      const c = await caption(p, it.version);
      it.nombre = c.maquina; it.dificultad = p.dificultad;
      it.texto = armarTexto(c, cfg, { max: maxTexto(it.redes) });
      if (it.redes.includes('youtube')) { it.tituloYT = tituloYT(c); it.tagsYT = tagsYT(c); }
      for (const f of [v.video, v.portada].filter(Boolean)) if (!remotos?.has(nfc(`${v.dir}/${f}`))) faltan.add(`${v.dir}/${f}`);
    }

    const prog = new Map();     // key|version -> [{red, fecha, hora, lote}]
    for (const l of d.lotes) for (const it of l.items) for (const red of it.redes) {
      const k = it.key + '|' + it.version;
      (prog.get(k) || prog.set(k, []).get(k)).push({ red, fecha: it.fecha, hora: it.hora, lote: l.id, publicado: yaPaso(it) });
    }
    const f = fechas(cfg, d);
    return {
      carpeta: ROOT, existe: existsSync(ROOT),
      config: { ...cfg, desde: f.desde, hasta: f.hasta, fechasAuto: f.auto }, base: configBase(), redes: REDES, dias: DIAS,
      drive: { conectado: !!remotos, faltan: [...faltan] },
      plan, trabajo: t0,
      pares: lista.map(p => ({
        key: p.key, nombre: p.nombre, dificultad: p.dificultad, fecha: p.fecha,
        estancado: d.estancados.includes(p.key),
        A: p.A ? { dir: p.A.dir, prog: prog.get(p.key + '|A') || [] } : null,
        B: p.B ? { dir: p.B.dir, prog: prog.get(p.key + '|B') || [] } : null,
      })),
      lotes: d.lotes.map(l => ({ id: l.id, creado: l.creado, archivo: path.basename(l.archivo), n: l.items.length, desde: l.items[0]?.fecha, hasta: l.items.at(-1)?.fecha, config: l.config })),
    };
  }

  // ---------- generar CSV ----------
  const csvCampo = v => /[",\n\r]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  async function encabezados() {
    if (!existsSync(PLANTILLA)) return ENCABEZADOS;
    const l = (await readFile(PLANTILLA, 'utf8')).replace(/^﻿/, '').split(/\r?\n/)[0];
    return l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).filter(x => x !== '').map(x => x.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
  }

  let preparando = false;   // evita que un doble clic arranque dos generaciones a la vez
  async function generar() {
    if (preparando || (trabajo && !trabajo.fin)) throw new Error('Ya se está generando un CSV.');
    preparando = true;
    try { await generarYa(); } finally { preparando = false; }
  }
  async function generarYa() {
    if (drive.subiendo()) throw new Error('Espera a que termine la subida a Drive.');
    const d = await leer();
    const cfg = d.config;
    const lista = await pares();
    const porKey = new Map(lista.map(p => [p.key, p]));
    const { items } = planificar(cfg, lista, d);
    if (!items.length) throw new Error('No hay nada que programar con esta configuración.');
    const remotos = await drive.enDrive({ refrescar: true });
    if (!remotos) throw new Error('Google Drive no está conectado.');
    const rutas = new Set();
    for (const it of items) { const v = porKey.get(it.key)[it.version]; [v.video, v.portada].filter(Boolean).forEach(f => rutas.add(nfc(`${v.dir}/${f}`))); }
    const faltan = [...rutas].filter(x => !remotos.has(x));
    if (faltan.length) throw new Error(`Faltan ${faltan.length} archivos en Drive. Súbelos primero en "Subir a Drive" (carpeta salida).`);

    const t = trabajo = { hechos: 0, total: rutas.size, inicio: Date.now() };
    (async () => {
      try {
        let i = 0; const lr = [...rutas];
        await Promise.all([1, 2, 3, 4].map(async () => { while (i < lr.length) { await drive.compartir(lr[i++]); t.hechos++; } }));
        // enlace de descarga directa: entrega el archivo (video/mp4, image/jpeg), no la página de Drive
        // al final va el nombre con su extensión (Drive lo ignora) para que Metricool reconozca video/imagen
        const link = ruta => `https://drive.usercontent.google.com/download?id=${remotos.get(ruta).id}&export=download&file=video.mp4`;
        const enc = await encabezados();
        const base = h => h.split(' (')[0].trim().toLowerCase();
        const filas = [];
        for (const it of items) {
          const p = porKey.get(it.key), v = p[it.version];
          const c = await caption(p, it.version);
          const ia = String(!!cfg.contenidoIA);
          const f = {
            Text: armarTexto(c, cfg, { max: maxTexto(it.redes) }), Date: it.fecha, Time: it.hora + ':00', Draft: 'false',
            ...Object.fromEntries(COLS_RED.map(col => [col, 'false'])),
            ...Object.fromEntries(it.redes.map(red => [REDES[red], 'true'])),
            'Picture Url 1': link(nfc(`${v.dir}/${v.video}`)),
            'Video Thumbnail Url': '',  // con portada, Metricool no carga el video
            Shortener: 'false',
            'Instagram Post Type': 'REEL', 'Instagram Show Reel On Feed': 'true', 'Facebook Post Type': 'REEL', 'Facebook Title': c.gancho.slice(0, 255),
            'YouTube Video Title': tituloYT(c), 'YouTube Video Type': cfg.youtubeTipo, 'YouTube Video Privacy': 'PUBLIC',
            'YouTube video for kids': 'false', 'YouTube notify subscribers': 'true',
            'YouTube Video Category': cfg.youtubeCategoria || '', 'YouTube Video Tags': tagsYT(c),
            'YouTube AI generated content': ia, 'TikTok AI generated content': ia, 'Pinterest AI generated content': ia,
            'TikTok Post Privacy': 'PUBLIC_TO_EVERYONE', 'TikTok Branded Content': 'false', 'TikTok Your Brand': 'false', 'TikTok Auto Add Music': 'false',
            'TikTok disable comments': 'false', 'TikTok disable duet': 'false', 'TikTok disable stitch': 'false',
          };
          const fl = Object.fromEntries(Object.entries(f).map(([k, x]) => [k.toLowerCase(), x]));
          filas.push(enc.map(h => csvCampo(fl[h.toLowerCase()] ?? fl[base(h)] ?? '')).join(','));
        }
        await mkdir(CSV_DIR, { recursive: true });
        const id = new Date().toISOString().replace(/[:.]/g, '-');
        const archivo = path.join(CSV_DIR, `metricool-salida-${items[0].fecha}_a_${items.at(-1).fecha}-${id.slice(11, 19)}.csv`);
        await writeFile(archivo, '﻿' + [enc.map(csvCampo).join(','), ...filas].join('\r\n') + '\r\n');
        const d2 = await leer();
        d2.lotes.push({
          id, creado: new Date().toISOString(), archivo,
          config: { porDia: cfg.porDia, horas: cfg.horas, redes: cfg.redes, diasA: cfg.diasA, youtubeTipo: cfg.youtubeTipo, contenidoIA: cfg.contenidoIA },
          items: items.map(({ fecha, hora, key, version, redes }) => ({ fecha, hora, key, version, redes })),
        });
        d2.config.desde = d2.config.hasta = null;   // el siguiente plan vuelve a la semana automática
        await guardar(d2);
        t.fin = Date.now(); t.lote = id;
      } catch (e) {
        t.fin = Date.now(); t.error = String(e.message || e);
      }
    })();
  }

  // ---------- rutas ----------
  return async function rutas(req, res, url, send) {
    const p = url.pathname;
    if (!p.startsWith('/api/metricool/')) return false;
    const ok = v => (send(res, 200, v ?? { ok: true }), true);
    if (req.method === 'GET' && p === '/api/metricool/estado') return ok(await estado());
    if (req.method === 'GET' && p === '/api/metricool/csv') {
      const d = await leer();
      const l = d.lotes.find(x => x.id === url.searchParams.get('id'));
      if (!l || !existsSync(l.archivo)) return send(res, 404, { error: 'No existe ese CSV' }), true;
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${path.basename(l.archivo)}"` });
      res.end(await readFile(l.archivo));
      return true;
    }
    if (req.method !== 'POST') return false;
    const b = await bodyJSON(req);
    const d = await leer();
    if (p === '/api/metricool/config') {
      const c = b.config || {}, n = { ...d.config };
      const fecha = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
      if (c.fechasAuto === true) n.desde = n.hasta = null;
      else {
        if (fecha(c.desde)) n.desde = c.desde;
        if (fecha(c.hasta)) { n.hasta = c.hasta; if (!n.desde) n.desde = fechas(n, d).desde; }
      }
      if (Number.isInteger(c.porDia) && c.porDia >= 1 && c.porDia <= 6) n.porDia = c.porDia;
      if (c.horas && typeof c.horas === 'object' && !Array.isArray(c.horas))
        n.horas = Object.fromEntries(Object.keys(REDES).map(k => [k, (Array.isArray(c.horas[k]) ? c.horas[k] : n.horas[k]).filter(h => /^\d{2}:\d{2}$/.test(h)).slice(0, 6)]));
      if (c.redes && typeof c.redes === 'object') n.redes = Object.fromEntries(Object.keys(REDES).map(k => [k, Math.max(0, Math.min(3, Number(c.redes[k]) || 0))]));
      if (Array.isArray(c.diasA)) n.diasA = c.diasA.map(Number).filter(x => x >= 0 && x <= 6);
      for (const k of ['detalle', 'hashtagMaquina', 'hashtagsTema', 'contenidoIA']) if (typeof c[k] === 'boolean') n[k] = c[k];
      if (typeof c.hashtags === 'string') n.hashtags = c.hashtags.slice(0, 200);
      if (['SHORT', 'VIDEO'].includes(c.youtubeTipo)) n.youtubeTipo = c.youtubeTipo;
      if (typeof c.youtubeCategoria === 'string' && /^[A-Z_]*$/.test(c.youtubeCategoria)) n.youtubeCategoria = c.youtubeCategoria;
      if (b.restablecer) Object.assign(n, configBase());
      d.config = n; await guardar(d); return ok();
    }
    if (p === '/api/metricool/estancado') {
      const s = new Set(d.estancados);
      b.valor ? s.add(String(b.key)) : s.delete(String(b.key));
      d.estancados = [...s]; await guardar(d); return ok();
    }
    if (p === '/api/metricool/generar') {
      try { await generar(); return ok(); } catch (e) { return send(res, 409, { error: e.message }), true; }
    }
    if (p === '/api/metricool/deshacer') {
      d.lotes = d.lotes.filter(l => l.id !== b.id); await guardar(d); return ok();
    }
    return false;
  };
}
