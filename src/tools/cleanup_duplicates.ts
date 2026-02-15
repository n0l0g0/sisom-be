
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Cleaning up duplicate contracts...');
  
  // Get all rooms
  const rooms = await prisma.room.findMany({
    include: {
      contracts: {
        where: {
          // Only look at contracts created recently (during our dev session)
          createdAt: {
            gte: new Date('2026-02-12T00:00:00Z')
          }
        },
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  let deletedCount = 0;

  for (const room of rooms) {
    const contracts = room.contracts;
    if (contracts.length <= 1) continue;

    // Find the active contract
    const activeContract = contracts.find(c => c.isActive);
    if (!activeContract) continue;

    // Find duplicates (inactive contracts for same tenant)
    const duplicates = contracts.filter(c => 
      !c.isActive && 
      c.tenantId === activeContract.tenantId && 
      c.id !== activeContract.id
    );

    for (const dup of duplicates) {
      console.log(`Deleting duplicate contract ${dup.id} for tenant ${dup.tenantId} in room ${room.number}`);
      await prisma.contract.delete({ where: { id: dup.id } });
      deletedCount++;
    }
  }

  console.log(`Deleted ${deletedCount} duplicate contracts.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
