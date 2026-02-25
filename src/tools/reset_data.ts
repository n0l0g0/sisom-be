import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tablenames = await prisma.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename FROM pg_tables WHERE schemaname='public'`;

  const tables = tablenames
    .map(({ tablename }) => tablename)
    .filter((name) => name !== '_prisma_migrations' && name !== 'User');

  for (const table of tables) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
      console.log(`Truncated ${table}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.log({ error: message });
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
