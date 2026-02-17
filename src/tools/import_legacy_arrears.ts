import { PrismaClient, InvoiceStatus } from '@prisma/client';

const prisma = new PrismaClient();

type ArrearEntry = {
  building: number;
  roomNumber: string;
  year: number;
  month: number;
  amount: number;
};

const arrears: ArrearEntry[] = [
  { building: 1, roomNumber: '9', year: 2026, month: 2, amount: 2731 },
  { building: 1, roomNumber: '20', year: 2026, month: 2, amount: 3032 },
  { building: 2, roomNumber: '17', year: 2026, month: 2, amount: 112 },
  { building: 2, roomNumber: '29', year: 2026, month: 2, amount: 2815 },
  { building: 4, roomNumber: '24', year: 2026, month: 2, amount: 2457 },
  { building: 4, roomNumber: '26', year: 2026, month: 2, amount: 2737 },
  { building: 4, roomNumber: '26', year: 2026, month: 1, amount: 2751 },
  { building: 4, roomNumber: '26', year: 2025, month: 12, amount: 3031 },
  { building: 4, roomNumber: '26', year: 2025, month: 11, amount: 3724 },
  { building: 4, roomNumber: '26', year: 2025, month: 10, amount: 2883 },
  { building: 5, roomNumber: '14', year: 2026, month: 2, amount: 2331 },
  { building: 6, roomNumber: '2', year: 2026, month: 2, amount: 2198 },
  { building: 6, roomNumber: '3', year: 2026, month: 2, amount: 2331 },
  { building: 6, roomNumber: '3', year: 2026, month: 1, amount: 2331 },
  { building: 6, roomNumber: '22', year: 2026, month: 2, amount: 2591 },
];

async function main() {
  for (const entry of arrears) {
    const buildingCode = `B${entry.building}`;

    const building = await prisma.building.findUnique({
      where: { code: buildingCode },
    });

    if (!building) {
      console.error(
        `Building not found for entry`,
        entry.building,
        entry.roomNumber,
      );
      continue;
    }

    const room = await prisma.room.findFirst({
      where: {
        number: entry.roomNumber,
        buildingId: building.id,
      },
    });

    if (!room) {
      console.error(
        `Room not found for entry`,
        entry.building,
        entry.roomNumber,
      );
      continue;
    }

    const contract = await prisma.contract.findFirst({
      where: {
        roomId: room.id,
        isActive: true,
      },
      orderBy: {
        startDate: 'desc',
      },
    });

    if (!contract) {
      console.error(
        `Active contract not found for entry`,
        entry.building,
        entry.roomNumber,
      );
      continue;
    }

    const existing = await prisma.invoice.findFirst({
      where: {
        contractId: contract.id,
        month: entry.month,
        year: entry.year,
      },
    });

    if (existing) {
      console.log(
        `Invoice already exists, skipping`,
        entry.building,
        entry.roomNumber,
        entry.year,
        entry.month,
      );
      continue;
    }

    const dueDate = new Date(entry.year, entry.month - 1, 5);

    const invoice = await prisma.invoice.create({
      data: {
        contractId: contract.id,
        month: entry.month,
        year: entry.year,
        rentAmount: entry.amount,
        waterAmount: 0,
        electricAmount: 0,
        otherFees: 0,
        discount: 0,
        totalAmount: entry.amount,
        status: InvoiceStatus.OVERDUE,
        dueDate,
      },
    });

    console.log(
      `Created invoice`,
      invoice.id,
      `for`,
      entry.building,
      entry.roomNumber,
      entry.year,
      entry.month,
      entry.amount,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
