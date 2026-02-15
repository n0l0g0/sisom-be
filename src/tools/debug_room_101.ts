import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const room = await prisma.room.findMany({
    where: { number: '101' },
    include: {
      building: true,
      contracts: {
        orderBy: { startDate: 'desc' },
        include: { tenant: true },
      },
    },
  });

  console.log(JSON.stringify(room, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
