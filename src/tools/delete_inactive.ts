import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Deleting inactive data...');

  // 1. Delete inactive contracts
  const deletedContracts = await prisma.contract.deleteMany({
    where: { isActive: false },
  });
  console.log(`Deleted ${deletedContracts.count} inactive contracts.`);

  // 2. Delete tenants with no contracts
  // Note: We need to find them first because deleteMany doesn't support relation filtering directly in all versions or complex conditions easily
  // But we can find IDs first.

  const tenantsToDelete = await prisma.tenant.findMany({
    where: {
      contracts: {
        none: {},
      },
    },
    select: { id: true },
  });

  const tenantIds = tenantsToDelete.map((t) => t.id);
  console.log(`Found ${tenantIds.length} tenants with no contracts to delete.`);

  if (tenantIds.length > 0) {
    const deletedTenants = await prisma.tenant.deleteMany({
      where: {
        id: { in: tenantIds },
      },
    });
    console.log(`Deleted ${deletedTenants.count} tenants.`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
