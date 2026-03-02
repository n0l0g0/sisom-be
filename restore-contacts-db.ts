
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function restoreContactsToDB() {
  console.log('Fetching active contracts...');
  
  const contracts = await prisma.contract.findMany({
    where: { isActive: true },
    include: {
      tenant: true,
      room: true,
    },
  });

  console.log(`Found ${contracts.length} active contracts.`);

  let addedCount = 0;

  for (const contract of contracts) {
    if (!contract.room || !contract.tenant) continue;
    
    const roomId = contract.room.id;
    const tenantName = contract.tenant.name;
    const tenantPhone = contract.tenant.phone;
    const lineUserId = contract.tenant.lineUserId;

    // Check if exists in DB
    const existing = await prisma.roomContact.findFirst({
      where: { roomId, phone: tenantPhone },
    });

    if (!existing) {
      await prisma.roomContact.create({
        data: {
          roomId,
          name: tenantName,
          phone: tenantPhone,
          lineUserId: lineUserId || null,
        },
      });
      addedCount++;
    } else {
        // Update lineUserId if needed
        if (lineUserId && existing.lineUserId !== lineUserId) {
            await prisma.roomContact.update({
                where: { id: existing.id },
                data: { lineUserId },
            });
        }
    }
  }

  console.log(`Added/Updated ${addedCount} contacts in DB.`);
}

restoreContactsToDB()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
