# Ajolo Publicador

Panel local para publicar los capítulos de **Ajololenguaje** en YouTube, X, LinkedIn, TikTok e Instagram. Para cada capítulo eliges qué versión (C o D) va a cada red y lo publicas cuando quieras.

## Abrir

Haz doble clic en **`Abrir Publicador.command`**. Se abre http://localhost:3939 en tu navegador. Deja abierta la ventana de Terminal mientras lo uses; al cerrarla, el panel se apaga.

> La primera vez, macOS puede bloquear el archivo por venir de "un desarrollador no identificado". En ese caso: clic derecho → **Abrir** → **Abrir**.

## Configurar (una sola vez)

1. Crea tu cuenta en https://upload-post.com, crea un **perfil** y conecta ahí YouTube, X, LinkedIn, TikTok e Instagram. Instagram tiene que ser cuenta Business o Creator.
2. En el panel, pulsa **Configurar** y escribe el nombre del perfil y tu API key. La key se guarda en el **Llavero** de macOS, no en archivos.

## Uso

- Cada capítulo muestra la portada de C y de D. Con **▶ Ver video** reproduces cada versión.
- En la tabla eliges, red por red, **—** (no publicar), **C** o **D**. Los botones *Todo C* y *Todo D* asignan la misma versión a todas las redes.
- El texto viene de `Texto para publicar - Version C.txt` y lo puedes editar antes de publicar. El contador avisa si pasa de 280 caracteres, el límite de X.
- El **título** solo se usa en YouTube y LinkedIn.
- **Programar** es opcional. Si lo dejas vacío, se publica en ese momento. La hora es la de Ciudad de México.
- **Publicar…** muestra un resumen y pide confirmación. Si eliges C y D en distintas redes, se hacen dos subidas.
- Las etiquetas junto a cada capítulo muestran lo ya publicado (✓) o lo que falló (✗). El **Historial** guarda cada envío; con *Actualizar estado* consultas a Upload-Post cómo va.

## Subir a Google Drive (pestaña "Subir a Drive")

Copia toda la carpeta de iCloud a **Mi unidad/Ajololenguaje - videos terminados** en tu Google Drive, con la misma estructura.

1. **Conectar (solo la primera vez):** pulsa **Conectar Google Drive**. Se abre tu navegador; elige tu cuenta y pulsa **Permitir**. El acceso es limitado: rclone solo puede ver los archivos que él mismo sube, no el resto de tu Drive.
2. **Subir:** pulsa **Subir N archivos pendientes**. Solo sube lo que falta. Si ya está en Drive con el mismo tamaño, lo salta.
3. **Durante la subida** ves:
   - el porcentaje total y los MB subidos;
   - cuántos archivos están subidos, subiéndose, pendientes o con error;
   - la velocidad y el tiempo restante;
   - el progreso de cada archivo, agrupado por capítulo. Puedes filtrar por estado.
4. **Detener:** puedes pararla cuando quieras. Al volver a pulsar Subir, continúa con lo que faltaba.
5. **Eliminar de Drive:**
   - **Uno por uno:** usa el botón 🗑 de cada archivo.
   - **Varios a la vez:** marca sus casillas y pulsa **Eliminar N de Drive** en la barra de abajo. La casilla del capítulo marca todo el capítulo y **Seleccionar todo** marca todos los archivos.
   - Siempre pide confirmación. Lo eliminado va a la **papelera de Drive** (se recupera ahí durante 30 días) y los originales de iCloud no se tocan. Si después pulsas Subir, se vuelve a subir.

- **Tiempo estimado antes de empezar:** a partir de la segunda subida se calcula con la velocidad de la anterior; la primera vez aparece al arrancar.
- **Si cierras la pestaña del navegador,** la subida sigue mientras la ventana de Terminal del panel esté abierta.
- **Herramientas:** usa **rclone 1.75.2**, instalado en `~/.local/bin/rclone`. Su configuración y el token de Google quedan en `~/.config/rclone/rclone.conf`.

## Detalles

- **Carpeta de videos:** `iCloud Drive/Ajololenguaje - videos terminados`. Si los videos no están descargados, iCloud los baja al publicar, así que la primera subida puede tardar. Para evitarlo: en Finder, clic derecho en la carpeta → **Mantener descargado**.
- **Portadas:** se usan como miniatura en YouTube y como portada en Instagram. En TikTok, la portada la elige TikTok.
- **Archivos que crea el panel:** `config.json` (nombre del perfil) e `historial.json` (registro de publicaciones). No borres el historial si quieres conservar el registro.
- **Requisitos:** Node.js en `~/.local/node`, ya instalado.

## Programar A/B en Metricool (pestaña "Programar A/B")

Sirve para la carpeta `iCloud Drive/salida`, donde cada video viene en dos versiones: `<fecha>-<nombre>` (A) y `<fecha>-<nombre>-b` (B).

**Configuración por defecto** (con **Restablecer por defecto** vuelves a ella):
- **Semana automática:** son 7 días, empezando el día siguiente a lo último programado. Después de generar un CSV, la siguiente semana empieza sola.
- **Solo videos sin programar:** se toman en orden de fecha y se salta lo que ya está en un CSV.
- **3 videos al día por red, escalonados en 2 grupos.**
  - Grupo 1: Instagram y Facebook (Reel). Grupo 2: YouTube (Short) y TikTok. X y LinkedIn vienen apagados porque no están conectados en Metricool; se activan en la página.
  - Un día el Grupo 1 publica los videos 1–3 y el Grupo 2 los 4–6; al día siguiente se invierten.
  - El escalonado continúa de una semana a la siguiente.
- **Versiones A:** solo los viernes y solo para los videos marcados como **Estancado**. Si no hay ninguno, el viernes lleva B.
- **Mejores horas por red** (Ciudad de México), según estudios generales de 2026. Conviene compararlas con "Best times" de Metricool.

  | Red | Horas |
  |---|---|
  | Instagram | 12:00, 18:00, 21:00 |
  | TikTok | 13:00, 19:00, 22:00 |
  | YouTube | 14:00, 17:00, 20:00 |
  | Facebook | 09:00, 13:00, 19:00 |
  | X | 09:00, 12:00, 18:00 |
  | LinkedIn | 08:30, 12:30, 17:00 |

**Textos** (salen de `caption.txt` de cada video):
- **Publicación:**
  - el gancho (primera línea);
  - el resumen con las técnicas, sin la ruta interna `piloto/…/writeup.md`;
  - "Máquina X · nivel Y";
  - hashtags: hasta 4 según lo que cuenta la descripción (por ejemplo #SQLInjection, #SUID, #SSH o #Esteganografia; la tabla está en `TEMAS`, en `metricool.mjs`), el de la máquina y los fijos `#hacking #ciberseguridad #ctf`.
- **Límite de X:** si la publicación va a X y pasa de 280 caracteres, se recorta quitando primero el resumen y luego los hashtags.
- **YouTube:**
  - título: "Máquina (dificultad) | gancho", con 100 caracteres como máximo;
  - etiquetas: la máquina, CTF, ciberseguridad, los temas de los hashtags y las técnicas del resumen;
  - categoría: Ciencia y tecnología.

**Pasos:**
1. **Sube la carpeta a Drive:** en "Subir a Drive" elige **salida** y súbela.
2. **Revisa la vista previa:** muestra día a día cada video con su texto, sus redes y su título de YouTube.
3. **Genera el CSV:** pulsa **Generar CSV para Metricool**. Los videos y portadas de ese plan quedan en Drive como "cualquiera con el enlace puede ver", porque Metricool lo necesita.
4. **Impórtalo en Metricool:** descárgalo desde "CSV generados" y usa **Planning → ⋮ → Import CSV**, con fecha `YYYY-MM-DD` y hora `HH:MM:SS`.
5. **Reporte:** en la sección **Reporte** eliges la semana (pasada, esta, próxima) o un rango con *Desde/hasta*; ‹ › mueven el rango completo. Muestra totales, conteo por red, por día y por video, y el detalle. Se descarga en **CSV** o con **Imprimir / PDF**. Es de programación (publicado = ya pasó su hora); las vistas y likes están en Metricool.
6. **Sigue el avance:** en "Videos" ves, para cada video, en qué red y fecha está programada cada versión. Lo que ya pasó de fecha aparece como ✓. Si generaste un CSV y **no** lo importaste, usa **Deshacer**.

Notas:
- Se usan los encabezados exactos de la plantilla oficial de Metricool, guardada en `metricool/plantilla.csv`.
- Los CSV se guardan en `metricool/csv/` y el registro en `metricool.json`.
