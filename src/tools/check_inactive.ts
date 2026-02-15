
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Checking inactive data...');

  // 1. Count inactive contracts
  const inactiveContractsCount = await prisma.contract.count({
    where: { isActive: false }
  });
  console.log(`Found ${inactiveContractsCount} inactive contracts.`);

  // 2. Sample inactive contracts
  const sampleInactiveContracts = await prisma.contract.findMany({
    where: { isActive: false },
    take: 5,
    include: { tenant: true, room: true }
  });
  console.log('Sample inactive contracts:', JSON.stringify(sampleInactiveContracts, null, 2));

  // 3. Count tenants with NO active contracts
  // First get all tenants
  const allTenants = await prisma.tenant.findMany({
    include: {
      contracts: {
        where: { isActive: true }
      }
    }
  });

  const tenantsNoActiveContract = allTenants.filter(t => t.contracts.length === 0);
  console.log(`Found ${tenantsNoActiveContract.length} tenants with no active contracts.`);
  
  if (tenantsNoActiveContract.length > 0) {
    console.log('Sample tenant with no active contract:', JSON.stringify(tenantsNoActiveContract[0], null, 2));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
