# Configuración de LiteSpeed para dtf.nineteencustom.com

Copias de referencia de dos archivos que viven en el servidor, **fuera** del
directorio de la app (`git pull` no los toca ni los despliega):

- `vhost.conf` → `/usr/local/lsws/conf/vhosts/dtf.nineteencustom.com/vhost.conf`
- `htaccess` → `public_html/.htaccess` (renombrado sin el punto inicial para
  que no quede oculto ni lo ignore ninguna herramienta)

Se versionan para poder ver el historial de cambios y tener un respaldo
fuera del propio servidor — no para desplegarse automáticamente. Un cambio
real se hace a mano en el servidor y **después** se refleja acá.

## Por qué existen dos archivos para lo mismo

Este LiteSpeed es compartido por 9 sitios (`app`, `api`, `cdn`, `ws`, etc.),
así que cualquier cambio en `vhost.conf` exige recargar el servicio entero.
Por eso el criterio es: lo que se pueda resolver en `.htaccess` (que solo
afecta a este sitio y no requiere reiniciar nada) se resuelve ahí primero.

## Caché del `index.html` (2026-08-28)

Sin `Cache-Control`, el navegador podía quedarse con una versión vieja del
`index.html` después de un despliegue — y como ese archivo es el que decide
qué build de JS/CSS cargar, la app parecía "no actualizada" aunque el
servidor ya tuviera el código nuevo. Pasó de verdad: se perdió tiempo
completo persiguiendo un despliegue que en realidad ya estaba bien.

Los assets (`index-<hash>.js`) llevan el hash del contenido en el nombre, así
que **no se tocan**: son seguros de cachear agresivamente, y de hecho siguen
cacheados (`max-age=14400` vía Cloudflare).

- **`vhost.conf`**: dos contextos nuevos, `exact:/` y `/index.html`, ambos
  apuntando al mismo archivo con `Cache-Control: no-cache, no-store,
  must-revalidate`. Hacen falta los dos porque LiteSpeed resuelve la raíz
  (`/`) con su mecanismo interno de "archivo índice", que no pasa en
  absoluto por el motor de reescritura de `.htaccess` -- sin el contexto
  `exact:/`, la ruta más común de todas (la raíz del sitio) quedaba sin la
  cabecera.
- **`htaccess`**: una regla `RewriteRule ^$ index.html` agregada antes de la
  reescritura general, para la raíz. En la práctica quedó redundante una vez
  agregado el contexto `exact:/` en `vhost.conf` (que sí alcanza), pero no
  molesta y documenta la intención en el lugar donde primero se la buscaría.

Verificado tras aplicar: los otros 8 sitios del servidor siguen respondiendo
igual (línea base tomada antes de tocar nada), los assets con hash conservan
su caché, y `/api/*` sigue sin cambios.
