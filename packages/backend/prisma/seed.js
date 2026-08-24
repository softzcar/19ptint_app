import "dotenv/config";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "nineteenvenezuela@gmail.com";
  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) {
    console.log(`Ya existe un usuario con email ${email}, no se vuelve a crear.`);
    return;
  }

  const password = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(9).toString("base64url");
  const usuario = await prisma.usuario.create({
    data: {
      nombre: "Admin",
      email,
      password_hash: await bcrypt.hash(password, 10),
      rol: "admin",
    },
  });

  await prisma.proyecto.create({
    data: { usuario_id: usuario.id, nombre: "Proyecto de prueba" },
  });

  console.log("Usuario admin creado:");
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
