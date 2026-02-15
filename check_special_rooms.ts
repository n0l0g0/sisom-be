import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const specialRooms = await prisma.room.findMany({
    where: {
      OR: [
        { number: { contains: '/' } },
        { number: { contains: 'บ้านน้อย' } }
      ]
    }
  });
  console.log('Special rooms:', specialRooms);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
