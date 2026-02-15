
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Checking duplicates for สาธิต...');
  const tenants = await prisma.tenant.findMany({
    where: { name: { contains: 'สาธิต' } },
    include: {
      contracts: {
        include: { room: true }
      }
    }
  });
  console.log(JSON.stringify(tenants, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
