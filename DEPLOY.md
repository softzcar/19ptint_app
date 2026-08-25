# Deploy al VPS

Guía para mover la app (ya probada en local, ver README.md) al VPS privado
sin GPU mencionado en CONTEXTO.md §3. Asume Ubuntu 22.04/24.04 con acceso
sudo y un dominio ya apuntando al VPS (para SSL con certbot). Todo corre
nativo (sin Docker), igual que en local — mismo motivo que en local: es la
topología más simple para un solo VPS.

## 0. Diferencia importante: Vulkan sin GPU

`realesrgan-ncnn-vulkan` necesita un dispositivo Vulkan. El VPS no tiene
GPU, así que hay que instalar un renderer Vulkan por software (`lavapipe`,
vía Mesa) para que el binario pueda inicializar y correr sobre CPU:

```bash
sudo apt install -y mesa-vulkan-drivers vulkan-tools
vulkaninfo | head -20   # debería listar "llvmpipe" como dispositivo
```

Va a ser sensiblemente más lento que en la Mac de desarrollo (que usa GPU
vía Metal) — esperado, ver CONTEXTO.md §3 "prioridad: que funcione, aunque
sea lento al inicio".

## 1. Paquetes del sistema

```bash
sudo apt update
sudo apt install -y nginx mysql-server redis-server git build-essential \
  curl unzip python3.12 python3.12-venv mesa-vulkan-drivers vulkan-tools

# Node 20+ (nodesource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

## 2. Clonar y preparar el código

```bash
sudo mkdir -p /opt/19print-app && sudo chown $USER:$USER /opt/19print-app
git clone <url-del-repo> /opt/19print-app
cd /opt/19print-app
npm install --omit=dev   # instala los 4 workspaces (packing-engine/backend/worker/frontend)
```

## 3. MySQL

```bash
sudo mysql <<'SQL'
CREATE DATABASE print19 CHARACTER SET utf8mb4;
CREATE USER 'print19'@'localhost' IDENTIFIED BY '<password-fuerte>';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON print19.* TO 'print19'@'localhost';
FLUSH PRIVILEGES;
SQL
```

(A diferencia del entorno local, acá NO se necesitan privilegios de shadow
database — se usa `prisma migrate deploy`, no `migrate dev`.)

## 4. Variables de entorno

`/opt/19print-app/packages/backend/.env`:
```
DATABASE_URL="mysql://print19:<password-fuerte>@localhost:3306/print19"
JWT_SECRET="<generar con: openssl rand -hex 32>"
PORT=4000
REDIS_URL="redis://localhost:6379"
CORS_ORIGIN="https://tu-dominio.com"
STORAGE_DIR="/var/lib/19print/storage"
PEXELS_API_KEY="<misma key que en local, o una nueva en pexels.com/api>"
```

`/opt/19print-app/packages/worker/.env`:
```
DATABASE_URL="mysql://print19:<password-fuerte>@localhost:3306/print19"
REDIS_URL="redis://localhost:6379"
AI_SERVICE_URL="http://localhost:8000"
STORAGE_DIR="/var/lib/19print/storage"
WORKER_CONCURRENCY=1
```

`/opt/19print-app/packages/ai-service/.env`:
```
MAX_LADO_PX=4000
REMBG_MODEL=u2netp
UPSCALE_SCALE=2
```

Storage fuera del repo, con permisos para el usuario de servicio:
```bash
sudo mkdir -p /var/lib/19print/storage/{originales,procesadas,exports}
sudo chown -R www-data:www-data /var/lib/19print/storage
```

## 5. Migraciones + seed

```bash
cd /opt/19print-app/packages/backend
npx prisma migrate deploy
npx prisma generate
SEED_ADMIN_EMAIL="admin@tudominio.com" npm run seed
```

## 6. Microservicio de IA (Python)

```bash
cd /opt/19print-app/packages/ai-service
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
deactivate

mkdir -p bin/ubuntu
curl -sL "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-ubuntu.zip" -o /tmp/re.zip
unzip -o /tmp/re.zip -d bin/ubuntu
chmod +x bin/ubuntu/realesrgan-ncnn-vulkan
```

(`app/config.py` autodetecta `bin/ubuntu` en Linux vs `bin/macos` en macOS,
no hace falta tocar código.)

## 7. Frontend (build estático)

```bash
cd /opt/19print-app/packages/frontend
npm run build   # genera dist/
```

## 8. systemd (backend, worker, ai-service)

`/etc/systemd/system/19print-backend.service`:
```ini
[Unit]
Description=19print backend
After=network.target mysql.service redis-server.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/19print-app/packages/backend
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/19print-worker.service`:
```ini
[Unit]
Description=19print worker (BullMQ)
After=network.target redis-server.service 19print-ai.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/19print-app/packages/worker
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/19print-ai.service`:
```ini
[Unit]
Description=19print ai-service (FastAPI)
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/19print-app/packages/ai-service
ExecStart=/opt/19print-app/packages/ai-service/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now 19print-ai 19print-backend 19print-worker
sudo systemctl status 19print-backend 19print-worker 19print-ai
```

## 9. Nginx + SSL

`/etc/nginx/sites-available/19print`:
```nginx
server {
    listen 80;
    server_name tu-dominio.com;

    client_max_body_size 30M;

    root /opt/19print-app/packages/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/19print /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tu-dominio.com
```

## 10. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

MySQL, Redis, el backend (4000) y el ai-service (8000) quedan solo en
`localhost` — no exponer esos puertos al exterior.

## 11. Redeploy (cambios futuros)

```bash
cd /opt/19print-app
git pull
npm install --omit=dev
npx prisma migrate deploy --schema packages/backend/prisma/schema.prisma
npm run build -w packages/frontend
sudo systemctl restart 19print-backend 19print-worker 19print-ai
```

## Pendientes (igual que en CONTEXTO.md §10)

- Migrar storage de disco local a Backblaze B2/Wasabi si el volumen lo justifica.
- Perfil ICC a embeber en el PDF de sublimación.
- Ajustar `WORKER_CONCURRENCY` según núcleos reales del VPS (arranca en 1).
