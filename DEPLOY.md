# Deploy al VPS

Guía para mover la app (ya probada en local, ver README.md) al VPS real donde
corre hoy: `dtf.ninesys19.com`, en el mismo servidor Contabo que aloja
`ninesys-api`/`app_multi` en Producción (`vps-contabo-prod`, ver
`ninesys-hub`). **No es Ubuntu**: es AlmaLinux 9 con CyberPanel/OpenLiteSpeed
ya instalado de antes para los otros vhosts — todo lo de acá asume eso, no un
VPS en blanco. Corre nativo (sin Docker), como el resto de vhosts del server.

## 0. Diferencia importante: Vulkan sin GPU

`realesrgan-ncnn-vulkan` necesita un dispositivo Vulkan. El VPS no tiene GPU,
así que hace falta un renderer Vulkan por software (`lavapipe`, vía Mesa)
para que el binario pueda inicializar y correr sobre CPU:

```bash
dnf install -y mesa-vulkan-drivers vulkan-tools
vulkaninfo | head -20   # debería listar "llvmpipe" como dispositivo
```

Va a ser sensiblemente más lento que en la Mac de desarrollo (que usa GPU vía
Metal) — esperado, ver CONTEXTO.md §3 "prioridad: que funcione, aunque sea
lento al inicio".

## 1. Paquetes del sistema

CyberPanel ya trae MariaDB, Redis, Node y Python — solo faltan estos:

```bash
dnf install -y git poppler-utils mesa-vulkan-drivers vulkan-tools
# poppler-utils es el que da pdfinfo/pdftoppm -- sin este paquete un lienzo
# subido en PDF (sublimación) se guarda con ancho_mm=0/alto_usado_mm=null en
# silencio (falla "best-effort", no bloquea la subida, ver routes/lienzos.js)
# y recién se nota cuando el presupuesto sale mal. Pasó en producción el
# 2026-08-28 -- verificar SIEMPRE con `which pdfinfo` antes de dar por buena
# una instalación nueva.

python3.12 -m ensurepip 2>&1 | tail -1   # confirmar que python3.12 -m venv funciona
```

Node 20 ya viene de CyberPanel; si hiciera falta instalarlo en otro server:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -   # Debian/Ubuntu
# En AlmaLinux/RHEL: curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs   # o apt install -y nodejs, según el sistema
```

## 2. Vhost (OpenLiteSpeed, no nginx)

El vhost real (`/home/dtf.ninesys19.com`) lo crea CyberPanel desde su
panel (Website > Create Website), apuntando el document root a
`public_html`. La configuración de headers/caché y el `.htaccess` que
realmente aplican quedan documentados y versionados en
`infra/dtf-litespeed/` (ver su README) — OpenLiteSpeed ignora `Header`
dentro de `.htaccess`, así que el cacheo real se define en `vhost.conf`, no
ahí.

## 3. Clonar y preparar el código

```bash
git clone git@github.com:softzcar/19ptint_app.git /home/dtf.ninesys19.com/app
cd /home/dtf.ninesys19.com/app
npm install   # con dev deps: hacen falta para "npm run build" del frontend (vite).
              # `npm install --omit=dev` rompe el build del frontend -- si se
              # necesita algo más liviano para el backend en runtime, instalar
              # con dev deps igual y no correr el build en el mismo paso.
```

## 4. MariaDB

```bash
mysql <<'SQL'
CREATE DATABASE print19 CHARACTER SET utf8mb4;
CREATE USER 'print19'@'localhost' IDENTIFIED BY '<password-fuerte>';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON print19.* TO 'print19'@'localhost';
FLUSH PRIVILEGES;
SQL
```

(Se usa `prisma migrate deploy`, no `migrate dev` — no hace falta shadow
database.)

## 5. Variables de entorno

`/home/dtf.ninesys19.com/app/packages/backend/.env`:
```
DATABASE_URL="mysql://print19:<password-fuerte>@localhost:3306/print19"
JWT_SECRET="<generar con: openssl rand -hex 32>"
PORT=4000
REDIS_URL="redis://localhost:6379"
CORS_ORIGIN="https://dtf.ninesys19.com"
STORAGE_DIR="/home/dtf.ninesys19.com/storage"
PEXELS_API_KEY="<key de pexels.com/api>"
NINESYS_API_URL="https://api.nineteengreen.com"   # Ninesys Dev (Postgres) -- ver CONTEXTO.md, la integración corre contra Dev, no contra Prod de Ninesys.
MSG_NINESYS_URL="<url del servicio de WhatsApp>"
MSG_NINESYS_DTF_TOKEN="<token de esta app en msg_ninesys>"
```

`/home/dtf.ninesys19.com/app/packages/worker/.env`:
```
DATABASE_URL="mysql://print19:<password-fuerte>@localhost:3306/print19"
REDIS_URL="redis://localhost:6379"
AI_SERVICE_URL="http://localhost:8000"
STORAGE_DIR="/home/dtf.ninesys19.com/storage"
WORKER_CONCURRENCY=1
```

`/home/dtf.ninesys19.com/app/packages/ai-service/.env`:
```
MAX_LADO_PX=4000
REMBG_MODEL=u2netp
UPSCALE_SCALE=2
```

Redis en este server es compartido con otras apps (`ntmsg-app`) — el
warning "Eviction policy is allkeys-lru. It should be noeviction" en los
logs de PM2 es de la config global del Redis del server, no de esta app; se
puede ignorar salvo que empiece a perder jobs de BullMQ por presión de
memoria.

Storage fuera del repo:
```bash
mkdir -p /home/dtf.ninesys19.com/storage/{originales,procesadas,exports}
```

## 6. Migraciones + seed

```bash
cd /home/dtf.ninesys19.com/app/packages/backend
npx prisma migrate deploy
npx prisma generate
SEED_ADMIN_EMAIL="admin@tudominio.com" npm run seed
```

## 7. Microservicio de IA (Python)

```bash
cd /home/dtf.ninesys19.com/app/packages/ai-service
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
deactivate

mkdir -p bin/ubuntu
curl -sL "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-ubuntu.zip" -o /tmp/re.zip
unzip -o /tmp/re.zip -d bin/ubuntu
chmod +x bin/ubuntu/realesrgan-ncnn-vulkan
```

(El zip de la release dice "ubuntu" en el nombre pero es un binario
prebuilt genérico de Linux x86_64 — corre igual en AlmaLinux, no hace falta
compilarlo aparte. `app/config.py` autodetecta la carpeta según
`platform.system()`: `bin/macos` en macOS, `bin/ubuntu` en cualquier otro
caso -- incluido Linux. OJO: una versión anterior de este documento decía
`bin/linux`, que es la carpeta EQUIVOCADA y deja el upscale roto en
silencio; usar siempre `bin/ubuntu`.)

## 8. Frontend (build estático)

```bash
cd /home/dtf.ninesys19.com/app/packages/frontend
npm run build   # genera dist/
rsync -a --delete --exclude='.htaccess' dist/ /home/dtf.ninesys19.com/public_html/
```

El `.htaccess` de `public_html` se excluye a propósito del rsync: es el que
vive versionado en `infra/dtf-litespeed/htaccess`, no el que genera Vite.

## 9. PM2 (backend, worker, ai-service)

No hay `ecosystem.config.js` — los tres procesos se registraron a mano.
Para levantarlos por primera vez en un server nuevo:

```bash
# Si el Node por defecto del server no es 20.x (revisar con `node -v`), usar
# --interpreter con la ruta explícita del binario de Node 20 (vía nvm) para
# backend y worker -- ai-service no lleva --interpreter de Node, corre su
# propio venv de Python.
cd /home/dtf.ninesys19.com/app/packages/backend && pm2 start src/server.js --name dtf-backend --interpreter /root/.nvm/versions/node/v20.20.2/bin/node
cd /home/dtf.ninesys19.com/app/packages/worker  && pm2 start src/index.js  --name dtf-worker  --interpreter /root/.nvm/versions/node/v20.20.2/bin/node
cd /home/dtf.ninesys19.com/app/packages/ai-service && pm2 start venv/bin/uvicorn --name dtf-ai --interpreter none -- app.main:app --host 127.0.0.1 --port 8000

pm2 save              # persiste la lista para el próximo reinicio del server
pm2 startup systemd   # solo la primera vez -- registra pm2-root.service
```

Para un redeploy normal alcanza con `pm2 restart <nombre>` (paso 11).

## 10. Firewall

MySQL (3306), Redis (6379), el backend (4000) y el ai-service (8000) quedan
solo en `localhost` — no exponer esos puertos al exterior. El firewall del
server ya lo gestiona CyberPanel (CSF), no hace falta tocarlo para esta app.

## 11. Redeploy (cambios futuros)

```bash
cd /home/dtf.ninesys19.com/app
git pull
npm install                                    # con dev deps, ver §3
npx prisma migrate deploy --schema packages/backend/prisma/schema.prisma
npx prisma generate --schema packages/backend/prisma/schema.prisma
npm run build -w packages/frontend
rsync -a --delete --exclude='.htaccess' packages/frontend/dist/ /home/dtf.ninesys19.com/public_html/
pm2 restart dtf-backend dtf-worker dtf-ai      # o solo el que corresponda al cambio
```

## Pendientes (igual que en CONTEXTO.md §10)

- Migrar storage de disco local a Backblaze B2/Wasabi si el volumen lo justifica.
- Perfil ICC a embeber en el PDF de sublimación.
- Ajustar `WORKER_CONCURRENCY` según núcleos reales del VPS (arranca en 1).
- Armar un `ecosystem.config.js` versionado para no depender de memoria/pm2 save al recrear los procesos.
