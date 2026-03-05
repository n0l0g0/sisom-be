import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

async function main() {
  console.log('Connecting to database:', process.env.DATABASE_URL);
  
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.includes('cozyhouse')) {
    console.error('SAFETY CHECK FAILED: DATABASE_URL does not contain "cozyhouse". Aborting.');
    process.exit(1);
  }

  const username = 'admin';
  const password = 'P@$$w0rd';
  const hashedPassword = await bcrypt.hash(password, 10);

  console.log(`Creating/Updating user: ${username}`);

  const user = await prisma.user.upsert({
    where: { username },
    update: {
      passwordHash: hashedPassword,
      role: Role.ADMIN,
    },
    create: {
      username,
      passwordHash: hashedPassword,
      role: Role.ADMIN,
      name: 'CozyHouse Admin',
      permissions: ['line_notifications', 'manage_users', 'view_reports', 'manage_contracts', 'manage_payments'],
    },
  });

  console.log('Admin user created/updated:', user);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });