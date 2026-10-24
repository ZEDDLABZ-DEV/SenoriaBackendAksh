import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Set ${name} before running this command.`);
  }
  return value;
}

async function main(): Promise<void> {
  const email = required("ADMIN_EMAIL").toLowerCase();
  const password = required("ADMIN_PASSWORD");
  const firstName = required("ADMIN_FIRST_NAME");
  const lastName = required("ADMIN_LAST_NAME");
  if (password.length < 12) {
    throw new Error("ADMIN_PASSWORD must be at least 12 characters.");
  }

  const existingAdmins = await prisma.user.count({ where: { role: "ADMIN" } });
  if (existingAdmins > 0) {
    throw new Error(
      "An administrator already exists. This command does not reset passwords or create another administrator.",
    );
  }

  const emailOwner = await prisma.user.findUnique({ where: { email } });
  if (emailOwner) {
    throw new Error("A user with that email already exists. Choose a different ADMIN_EMAIL.");
  }

  const admin = await prisma.user.create({
    data: {
      id: randomUUID(),
      email,
      passwordHash: await hashPassword(password),
      firstName,
      lastName,
      role: "ADMIN",
      status: "active",
    },
  });

  console.log(`Administrator created. id=${admin.id} email=${admin.email}`);
  console.log("The password was not printed.");
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Administrator bootstrap failed.";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
