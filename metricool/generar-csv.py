#!/usr/bin/env python3
"""Genera el CSV de importación de Metricool para Ajololenguaje.

- 2 videos al día; la versión D de cada capítulo sale 4 días después de su versión C.
- Los videos y portadas se toman de Google Drive (subidos por el panel) y se
  comparten como "cualquiera con el enlace puede ver", que es lo que pide Metricool.

Uso:  python3 generar-csv.py [--compartir] [plantilla-metricool.csv]
--compartir: además pone cada video/portada como "cualquiera con el enlace puede ver".
Si se pasa la plantilla descargada de Metricool, se usan sus encabezados exactos.
"""
import csv, json, os, subprocess, sys, unicodedata
from datetime import date, timedelta
from pathlib import Path

RCLONE = os.path.expanduser('~/.local/bin/rclone')
REMOTO = 'gdrive:Ajololenguaje - videos terminados'
ICLOUD = Path.home() / 'Library/Mobile Documents/com~apple~CloudDocs/Ajololenguaje - videos terminados'
SALIDA = Path(__file__).with_name('metricool-ajololenguaje.csv')
PLANTILLA = Path(__file__).with_name('plantilla.csv')

# ---- ajustes ----
YA_PUBLICADOS = {(1, 'C'): date(2026, 11, 9)}   # capítulo 01 versión C ya salió el 9 nov
INICIO = date(2026, 11, 10)                     # primer día a programar
HORAS = ['13:00:00', '19:00:00']                # 2 publicaciones al día (hora de Ciudad de México)
SEPARACION = 4                                  # días entre versión C y D del mismo capítulo
REDES = {'Facebook': False, 'Twitter/X': True, 'LinkedIn': True, 'GBP': False, 'Instagram': True,
         'Pinterest': False, 'TikTok': True, 'YouTube': True, 'Threads': False, 'Bluesky': False}

ENCABEZADOS = (
    ['Text', 'Date', 'Time', 'Draft', *REDES]
    + [f'Picture Url {i}' for i in range(1, 11)]
    + [f'Alt text picture {i}' for i in range(1, 11)]
    + ['Document title', 'Shortener', 'Video Thumbnail Url', 'Video Cover Frame',
       'Twitter/X Can reply', 'Twitter/X Type', 'Twitter/X Poll Duration minutes']
    + [f'Twitter/X Poll Option {i}' for i in range(1, 5)]
    + ['Pinterest Board', 'Pinterest Pin Title', 'Pinterest Pin Link', 'Pinterest Pin New Format',
       'Instagram Post Type', 'Instagram Show Reel On Feed',
       'YouTube Video Title', 'YouTube Video Type', 'YouTube Video Privacy', 'YouTube video for kids',
       'YouTube Video Category', 'YouTube Video Tags', 'YouTube Playlist', 'YouTube Notify Subscribers',
       'GBP Post Type', 'Facebook Post Type', 'Facebook Title', 'First Comment Text',
       'TikTok Title', 'TikTok disable comments', 'TikTok disable duet', 'TikTok disable stitch',
       'TikTok Post Privacy', 'TikTok Branded Content', 'TikTok Your Brand', 'TikTok Auto Add Music',
       'TikTok Photo Cover Index', 'TikTok musicId', 'TikTok music title', 'TikTok music author',
       'TikTok music previewUrl', 'TikTok music thumbnailUrl', 'TikTok music soundVolume',
       'TikTok music originalVolume', 'TikTok music startMillis', 'TikTok music endMillis',
       'LinkedIn Type', 'LinkedIn Poll Question']
    + [f'LinkedIn Poll Option {i}' for i in range(1, 5)]
    + ['LinkedIn Poll Duration', 'LinkedIn Show link preview', 'LinkedIn Images as Carousel',
       'Threads Reply Control', 'Threads Is Spoiler', 'Threads Post Type', 'Brand name']
)

COMPARTIR = '--compartir' in sys.argv
ARGS = [a for a in sys.argv[1:] if a != '--compartir']
nfc = lambda s: unicodedata.normalize('NFC', s)


def calendario(capitulos):
    """Cada día: primero las D que tocan (C + 4 días), luego se rellena con la siguiente C."""
    hecho = dict(YA_PUBLICADOS)
    cola_c = [n for n in capitulos if (n, 'C') not in hecho]
    plan, dia = [], INICIO
    while len([k for k in hecho if k[1] == 'D']) < len(capitulos):
        hoy = [(n, 'D') for n in capitulos
               if (n, 'C') in hecho and (n, 'D') not in hecho and hecho[(n, 'C')] + timedelta(SEPARACION) <= dia]
        assert len(hoy) <= len(HORAS), 'demasiadas D el mismo día'
        while len(hoy) < len(HORAS) and cola_c:
            hoy.append((cola_c.pop(0), 'C'))
        for (n, v), hora in zip(hoy, HORAS):
            hecho[(n, v)] = dia
            plan.append((dia, hora, n, v))
        dia += timedelta(1)
    return plan


def main():
    lista = json.loads(subprocess.run([RCLONE, 'lsjson', '-R', '--files-only', '--no-mimetype', '--no-modtime', REMOTO],
                                      check=True, capture_output=True, text=True).stdout)
    ids = {nfc(f['Path']): f['ID'] for f in lista}
    carpetas = sorted(nfc(p.name) for p in ICLOUD.iterdir() if p.is_dir() and p.name[:2].isdigit())
    capitulos = {int(c[:2]): c for c in carpetas}

    enc = ENCABEZADOS
    if ARGS or PLANTILLA.exists():   # encabezados exactos de la plantilla de Metricool
        with open(ARGS[0] if ARGS else PLANTILLA, newline='', encoding='utf-8-sig') as f:
            enc = next(csv.reader(f))

    compartidos = set()
    def enlace(ruta):
        if ruta not in ids:
            sys.exit(f'No está en Drive: {ruta}')
        if COMPARTIR and ruta not in compartidos:   # "cualquiera con el enlace puede ver"
            subprocess.run([RCLONE, 'link', f'{REMOTO}/{ruta}'], check=True, capture_output=True)
            compartidos.add(ruta)
        return f'https://drive.google.com/file/d/{ids[ruta]}/view?usp=sharing'

    filas = []
    for dia, hora, n, v in calendario(sorted(capitulos)):
        carpeta = capitulos[n]
        nombre = carpeta.split(' - ', 1)[1]
        texto = (ICLOUD / carpeta / f'Texto para publicar - Version {v}.txt').read_text(encoding='utf-8').strip()
        assert len(texto) <= 280, f'{carpeta} {v}: el texto pasa de 280 caracteres (X)'
        titulo = f'{nombre} · Ajololenguaje {n:02d}/15'
        assert len(titulo) <= 100
        fila = {
            'Text': texto, 'Date': dia.isoformat(), 'Time': hora, 'Draft': 'false',
            **{red: 'true' if on else 'false' for red, on in REDES.items()},
            'Picture Url 1': enlace(f'{carpeta}/{carpeta} - Version {v}.mp4'),
            'Video Thumbnail Url': enlace(f'{carpeta}/Portada - Version {v}.jpg'),
            'Instagram Post Type': 'REEL', 'Instagram Show Reel On Feed': 'true',
            'YouTube Video Title': titulo, 'YouTube Video Type': 'SHORT', 'YouTube Video Privacy': 'PUBLIC',
            'YouTube video for kids': 'false', 'YouTube Notify Subscribers': 'true', 'YouTube AI generated content': 'false',
            'YouTube Video Category': 'EDUCATION', 'TikTok AI generated content': 'false', 'Shortener': 'false',
            'TikTok disable comments': 'false', 'TikTok disable duet': 'false', 'TikTok disable stitch': 'false',
        }
        # con plantilla, empata nombres aunque traigan "(up to 10)" o "(personal accounts only)"
        base = lambda h: h.split(' (')[0].strip()
        fl = {k.lower(): v for k, v in fila.items()}
        filas.append([fl.get(h.lower(), fl.get(base(h).lower(), '')) for h in enc])
        print(f'{dia:%a %d %b} {hora[:5]}  {n:02d} {v}  {nombre}')

    with open(SALIDA, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(enc)
        w.writerows(filas)
    print(f'\n{len(filas)} publicaciones -> {SALIDA}')


main()
