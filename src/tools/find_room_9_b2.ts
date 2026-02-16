import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Finding tenant for Building 2 Room 9...');

  // First find building 2 (assuming name contains '2' or code)
  // Or just search room number '9' and check building

  const room = await prisma.room.findFirst({
    where: {
      number: '9',
      building: {
        name: { contains: '2' },
      },
    },
    include: {
      building: true,
      contracts: {
        where: { isActive: true },
        include: { tenant: true },
      },
    },
  });

  if (!room) {
    console.log('Room 9 in Building 2 not found.');
    // Try finding all rooms with number 9
    const rooms = await prisma.room.findMany({
      where: { number: '9' },
      include: { building: true },
    });
    console.log('Rooms with number 9:', JSON.stringify(rooms, null, 2));
    return;
  }

  console.log('Found room:', JSON.stringify(room, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
