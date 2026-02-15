import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rooms = await prisma.room.findMany({ orderBy: { floor: 'asc' } });
  const floors = Array.from(new Set(rooms.map((r) => r.floor)));
  for (const f of floors) {
    const code = `B${f}`;
    const building = await prisma.building.upsert({
      where: { code },
      update: { name: `ตึก ${f}`, floors: 1 },
      create: { name: `ตึก ${f}`, code, floors: 1 },
    });
    const rs = rooms.filter((r) => r.floor === f);
    for (const r of rs) {
      await prisma.room.update({
        where: { id: r.id },
        data: { buildingId: building.id },
      });
    }
  }
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
