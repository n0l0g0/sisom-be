
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Checking Watcharaporn...');
  const tenants = await prisma.tenant.findMany({
    where: { 
      OR: [
        { name: { contains: 'วัชราภรณ์' } },
        { name: { contains: 'สุพัตรา' } }
      ]
    },
    include: {
      contracts: {
        where: { isActive: true },
        include: { room: true }
      }
    }
  });
  console.log(JSON.stringify(tenants, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
