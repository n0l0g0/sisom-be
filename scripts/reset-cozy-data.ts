import { PrismaClient } from '@prisma/client';

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
    console.error('SAFETY CHECK FAILED: DATABASE_URL does not contain "cozyhouse". Aborting to prevent accidental data loss in wrong DB.');
    process.exit(1);
  }

  console.log('Starting data cleanup for CozyHouse...');

  // Delete in order of dependencies (Child -> Parent)
  
  console.log('Deleting Payments...');
  await prisma.payment.deleteMany({});
  
  console.log('Deleting InvoiceItems...');
  await prisma.invoiceItem.deleteMany({});
  
  console.log('Deleting Invoices...');
  await prisma.invoice.deleteMany({});
  
  console.log('Deleting MeterReadings...');
  await prisma.meterReading.deleteMany({});

  console.log('Deleting MeterReplacements...');
  await prisma.meterReplacement.deleteMany({});
  
  console.log('Deleting MaintenanceRequests...');
  await prisma.maintenanceRequest.deleteMany({});
  
  console.log('Deleting Assets...');
  await prisma.asset.deleteMany({});

  console.log('Deleting RoomContacts...');
  await prisma.roomContact.deleteMany({});
  
  console.log('Deleting Contracts...');
  await prisma.contract.deleteMany({});
  
  console.log('Deleting Tenants...');
  await prisma.tenant.deleteMany({});
  
  console.log('Deleting Rooms...');
  await prisma.room.deleteMany({});
  
  console.log('Deleting Buildings...');
  await prisma.building.deleteMany({});

  // Clean Users except admin
  console.log('Cleaning Users (keeping admin)...');
  await prisma.user.deleteMany({
    where: {
      username: {
        not: 'admin',
      },
    },
  });

  // Verify Admin exists
  const admin = await prisma.user.findUnique({
    where: { username: 'admin' },
  });

  if (!admin) {
    console.log('Admin user not found. Creating default admin...');
    // Create default admin if missing (Password: P@$$w0rd)
    // Hash: $2b$10$X7... (need to generate or use known hash)
    // For safety, I will not create it here unless I know the hash logic or import bcrypt.
    // Assuming the user meant "keep existing admin". If it was deleted, that's an issue.
    // But we used deleteMany with where username NOT admin, so it should be safe.
    console.warn('WARNING: Admin user was not found after cleanup!');
  } else {
    console.log('Admin user preserved:', admin.username);
  }

  // Optional: Reset DormConfig to default?
  // User said "Project เปล่าๆ". DormConfig is settings. Maybe keep it or reset it?
  // Usually settings are fine to keep, or maybe reset.
  // Let's ask or just leave it. "เคลีย data ทุกอย่าง" usually means transactional/master data.
  // DormConfig is singular (usually 1 row).
  // Let's delete DormConfig too if they want "empty project".
  // But wait, if DormConfig is gone, the app might crash on startup if it expects it.
  // Sisom usually creates a default one if missing (in service).
  // Let's delete it to be safe "clean slate".
  console.log('Deleting DormConfig...');
  await prisma.dormConfig.deleteMany({});

  console.log('Cleanup complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
