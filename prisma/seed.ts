import { PrismaClient, Role } from '@prisma/client'
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
