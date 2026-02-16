import { PrismaClient, Role, InvoiceStatus, TenantStatus, RoomStatus } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import * as dotenv from 'dotenv'

dotenv.config()

const prisma = new PrismaClient()

async function main() {
  // Create Admin User
  const adminPassword = await bcrypt.hash('P@$$w0rd', 10);
  const adminUser = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash: adminPassword,
      name: 'System Admin',
      role: Role.OWNER,
      permissions: [],
    },
  });
  console.log('Admin user seeded:', adminUser.username);

  const building2 = await prisma.building.upsert({
    where: { code: 'B2' },
    update: {
      name: 'ตึก 2',
      floors: 5,
    },
    create: {
      name: 'ตึก 2',
      code: 'B2',
      floors: 5,
    },
  });

  let room9 = await prisma.room.findFirst({
    where: {
      number: '9',
      floor: 2,
      buildingId: building2.id,
    },
  });

  if (!room9) {
    room9 = await prisma.room.create({
      data: {
        number: '9',
        floor: 2,
        status: RoomStatus.OCCUPIED,
        pricePerMonth: 4000,
        buildingId: building2.id,
      },
    });
  }

  let tenant = await prisma.tenant.findFirst({
    where: {
      phone: '0999999999',
    },
  });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: 'ผู้เช่าจำลอง ห้อง 9',
        phone: '0999999999',
        status: TenantStatus.ACTIVE,
      },
    });
  }

  let contract = await prisma.contract.findFirst({
    where: {
      roomId: room9.id,
      isActive: true,
    },
  });

  if (!contract) {
    contract = await prisma.contract.create({
      data: {
        tenantId: tenant.id,
        roomId: room9.id,
        startDate: new Date(new Date().getFullYear(), 0, 1),
        deposit: 4000,
        currentRent: 4000,
        occupantCount: 1,
        isActive: true,
      },
    });
  }

  const year = new Date().getFullYear();

  for (let i = 0; i < 5; i++) {
    const month = i + 1;
    const exists = await prisma.invoice.findFirst({
      where: {
        contractId: contract.id,
        month,
        year,
      },
    });
    if (exists) continue;
    const rentAmount = 4000;
    const waterAmount = Math.floor(Math.random() * 300) + 100;
    const electricAmount = Math.floor(Math.random() * 500) + 200;
    const otherFees = 0;
    const discount = 0;
    const totalAmount = rentAmount + waterAmount + electricAmount + otherFees - discount;
    const overdue = Math.random() < 0.5;
    await prisma.invoice.create({
      data: {
        contractId: contract.id,
        month,
        year,
        rentAmount,
        waterAmount,
        electricAmount,
        otherFees,
        discount,
        totalAmount,
        status: overdue ? InvoiceStatus.OVERDUE : InvoiceStatus.SENT,
        dueDate: new Date(year, month - 1, 5),
      },
    });
  }

  // Room seeding disabled as per user request to manage rooms manually
  /*
  // Create Rooms for 5 Floors, 10 Rooms each (e.g., 101-110, 201-210)
  const floors = [1, 2, 3, 4, 5]
  const roomsPerFloor = 10

  for (const floor of floors) {
    for (let i = 1; i <= roomsPerFloor; i++) {
      const roomNumber = `${floor}${i.toString().padStart(2, '0')}`
      
      const exists = await prisma.room.findUnique({
        where: { number: roomNumber }
      })

      if (!exists) {
        await prisma.room.create({
          data: {
            number: roomNumber,
            floor: floor,
            pricePerMonth: 3500.00, // Default price
            status: 'VACANT',
          }
        })
      }
    }
  }
  */

  console.log('Seeding completed.')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
