import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Searching for tenants...');

  const tenants = await prisma.tenant.findMany({
    where: {
      OR: [
        { name: { contains: 'ศุภชิชญ์' } },
        { name: { contains: 'ศุภวิชญ์' } },
        { name: { contains: 'ปนัดดา' } },
        { name: { contains: 'นิสา' } },
      ],
    },
    include: {
      contracts: {
        where: { isActive: true },
        include: { room: true },
      },
    },
  });

  console.log(JSON.stringify(tenants, null, 2));
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
