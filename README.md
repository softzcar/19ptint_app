# 19print — Armado de lienzos DTF/Sublimación

Ver `CONTEXTO.md` para la especificación completa del producto y `DEPLOY.md`
para migrar esto al VPS.

## Estructura

```
packages/
  packing-engine/   motor de acomodo (guillotine + reglas de rotación), con tests
  backend/          API Express + Prisma/MySQL + BullMQ + export
  worker/           consumer BullMQ, llama al ai-service
  ai-service/       FastAPI (Python): quitar fondo (rembg) + upscale (realesrgan)
  frontend/         Vue 3 + Vite + Konva.js
```

## Primer setup local (Mac)

```bash
brew install mysql redis python@3.12
brew services start mysql redis

npm install                              # workspaces JS (raíz)
bash scripts/setup-ai-service.sh         # venv Python + binario realesrgan

# base de datos (usar las mismas credenciales que packages/backend/.env)
mysql -u root -e "CREATE DATABASE print19; CREATE USER 'print19'@'localhost' IDENTIFIED BY 'print19'; GRANT ALL ON print19.* TO 'print19'@'localhost';"

cp packages/backend/.env.example packages/backend/.env   # y completar JWT_SECRET
cp packages/worker/.env.example packages/worker/.env
cp packages/ai-service/.env.example packages/ai-service/.env

cd packages/backend && npx prisma migrate dev --name init && npm run seed
```

El seed imprime el email/password del usuario admin para el primer login.

## Búsqueda de imágenes (Pexels)

Para poder buscar fotos de stock desde la app (además de subir archivos):

1. Crear una cuenta gratis en https://www.pexels.com/api/ y generar una API key.
2. Pegarla en `packages/backend/.env`: `PEXELS_API_KEY="tu-key"`.
3. Reiniciar el backend.

Sin la key, el botón "Buscar en internet" muestra un error explicando que
falta configurarla — el resto de la app funciona igual.

## Correr todo

```bash
bash scripts/dev.sh
```

Levanta backend (`:4000`), worker, ai-service (`:8000`) y frontend
(`:5173`). Abrir `http://localhost:5173`.

## Tests

```bash
npm test   # motor de acomodo (vitest)
```
