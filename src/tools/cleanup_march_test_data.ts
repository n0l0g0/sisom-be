import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const targetMonth = 3;
  const targetYear = new Date().getFullYear();

  // Find rooms: Building 2, Floor 1 Room 9 and Floor 3 Room 21
  const rooms = await prisma.room.findMany({
    where: {
      OR: [
        { building: { code: 'ตึก 2' }, floor: 1, number: '9' },
        { building: { code: 'ตึก 2' }, floor: 3, number: '21' },
      ],
    },
  });

  const roomIds = rooms.map((r) => r.id);

  if (roomIds.length) {
    await prisma.meterReading.deleteMany({
      where: {
        roomId: { in: roomIds },
        month: targetMonth,
        year: targetYear,
      },
    });
  }

  // Delete all invoices for March of targetYear
  await prisma.invoice.deleteMany({
    where: { month: targetMonth, year: targetYear },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

