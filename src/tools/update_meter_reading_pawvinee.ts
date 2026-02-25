import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();
/**
 * Update electric meter readings for:
 * Building 5, Room 7, Tenant "นางสาว ภาวิณี เพิ่มพูล"
 * - February: set electricReading to 8899
 * - March: set electricReading to 8913
 * Assumption: year = current year
 */
const prisma = new PrismaClient();

async function findTargetRoomId() {
  const tenantName = 'นางสาว ภาวิณี เพิ่มพูล';
  const candidates = await prisma.contract.findMany({
    where: {
      isActive: true,
      tenant: { name: tenantName },
    },
    include: { room: { include: { building: true } }, tenant: true },
  });
  // Prefer exact match: building code/name contains '5' and room.number === '7'
  const pick = candidates.find(
    (c) =>
      !!c.room &&
      !!c.room.building &&
      (String(c.room.building.code || '').includes('5') ||
        String(c.room.building.name || '').includes('5')) &&
      String(c.room.number || '') === '7',
  );
  if (pick?.room?.id) return pick.room.id;
  // Fallback: strict building code 'B5' then number '7'
  const b5 = await prisma.building.findFirst({
    where: {
      OR: [{ code: 'B5' }, { code: 'ตึก 5' }, { name: { contains: '5' } }],
    },
    select: { id: true },
  });
  if (!b5) return null;
  const room = await prisma.room.findFirst({
    where: { buildingId: b5.id, number: '7' },
    select: { id: true },
  });
  return room?.id || null;
}

async function upsertElectric(
  roomId: string,
  month: number,
  year: number,
  electricReading: number,
) {
  const existing = await prisma.meterReading.findUnique({
    where: { roomId_month_year: { roomId, month, year } },
  });
  if (existing) {
    await prisma.meterReading.update({
      where: { id: existing.id },
      data: { electricReading },
    });
    return { action: 'update', id: existing.id };
  }
  await prisma.meterReading.create({
    data: {
      roomId,
      month,
      year,
      waterReading: 0,
      electricReading,
    },
  });
  return { action: 'create' };
}

async function main() {
  const roomId = await findTargetRoomId();
  if (!roomId) {
    console.error('Room not found for Building 5, Room 7, tenant match');
    return;
  }
  const now = new Date();
  const year = now.getFullYear();
  const feb = await upsertElectric(roomId, 2, year, 8899);
  const mar = await upsertElectric(roomId, 3, year, 8913);
  console.log(
    JSON.stringify(
      { ok: true, roomId, year, results: { feb, mar } },
      null,
      2,
    ),
  );
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
