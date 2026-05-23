import { PrismaClient, Role, RoomStatus, TenantStatus, InvoiceStatus, PaymentStatus, WaterFeeMethod } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://admin:password@127.0.0.1:5433/sisomapt_demo?schema=public' } },
});

// ---- helpers ----
function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function daysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}
function monthsAgo(months: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}
function addMonths(date: Date, n: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

// ---- Thai name data ----
const FIRST_NAMES = [
  'สมชาย','สมหญิง','วิชัย','นภาพร','ธนพล','อรทัย','พิชัย','สุภาพร',
  'ณัฐพล','จิราภา','กิตติพงษ์','มณีรัตน์','ชัยวัฒน์','นิภาพร','สรวิชญ์',
  'กัญญารัตน์','ปิยะพงษ์','ศิริพร','ธีรพงษ์','อัญชลี','วิทวัส','พิมพ์ใจ',
  'ชาติชาย','รัตนาภรณ์','เกรียงไกร','สุดาพร','ภาณุวัฒน์','จันทร์เพ็ญ',
  'กฤษณะ','วรรณิภา','ประเสริฐ','นันทพร','ภานุพงศ์','ศิริลักษณ์',
  'สุรเชษฐ์','อภิชาติ','พัชรินทร์','ธนกร','วาสนา','นัทธมน',
];
const LAST_NAMES = [
  'มีสุข','รักสกุล','ใจดี','สกุลไทย','พรพิทักษ์','วงศ์สุวรรณ',
  'ชัยมงคล','ศรีวิไล','ทองดี','บุญมา','หิรัญ','พันธุ์ดี',
  'สุขสวัสดิ์','เจริญสุข','รุ่งเรือง','ประทุม','กาญจนา','สิทธิ์ดี',
  'อุดม','แสงทอง','ดาวเรือง','ศรีสมบูรณ์','เพ็ชรดี','ลาภมี',
  'พิทักษ์ชัย','มั่งมี','ชัยภูมิ','บุญชู','ศรีสมาน','ไพบูลย์',
  'สุขใจ','ใจงาม','พงษ์สุวรรณ','รักไทย','ดีมาก','ขยัน','สิริมา',
];
function randomName(): { name: string; nickname: string } {
  const fn = pick(FIRST_NAMES);
  const ln = pick(LAST_NAMES);
  const nicknames = ['มิ้น','แนน','พอ','โอ๋','นิ','บอย','ฝน','แก้ม','บี','ปั้น','นิ่ม','ป้อม','โจ','แป้ง','โอ'];
  return { name: `${fn} ${ln}`, nickname: pick(nicknames) };
}
function randomPhone(): string {
  const prefix = pick(['061','062','063','064','065','080','081','082','083','084','085','086','090','091','092','093','094','095','096','097','098','099']);
  const suffix = String(rand(1000000, 9999999));
  return `${prefix}${suffix}`;
}

// ---- Building + Room layout ----
const BUILDINGS = [
  { name: 'ตึก A', code: 'A', floors: 5, roomsPerFloor: 8 },
  { name: 'ตึก B', code: 'B', floors: 4, roomsPerFloor: 6 },
  { name: 'ตึก C', code: 'C', floors: 3, roomsPerFloor: 4 },
];

// ---- Main ----
async function main() {
  console.log('🌱 Starting demo seed...');

  // 1. DormConfig
  await prisma.dormConfig.deleteMany();
  await prisma.dormConfig.create({
    data: {
      dormName: 'เดโม่ แมนชั่น',
      address: '123 ถ.พหลโยธิน แขวงลาดยาว เขตจตุจักร กรุงเทพฯ 10900',
      phone: '02-123-4567',
      waterUnitPrice: 18,
      waterFeeMethod: WaterFeeMethod.METER_USAGE,
      electricUnitPrice: 8,
      electricFeeMethod: WaterFeeMethod.METER_USAGE,
      commonFee: 500,
      bankAccount: 'ธ.กสิกรไทย 123-4-56789-0',
      monthlyDueDay: 5,
    },
  });
  console.log('✅ DormConfig created');

  // 2. Users
  await prisma.user.deleteMany({ where: { username: { in: ['demo', 'staff'] } } });
  const demoPass = await bcrypt.hash('demo1234', 10);
  const staffPass = await bcrypt.hash('staff1234', 10);
  const allPermissions = [
    'dashboard','chats','floor_plan','meter','bills','payments','contracts',
    'reports','maintenance','move_out','former_tenants','activity_logs',
    'settings_dorm','settings_rent','settings_backups','settings_users','settings_profile',
  ];
  await prisma.user.createMany({
    data: [
      { username: 'demo', passwordHash: demoPass, role: Role.ADMIN, name: 'ผู้ดูแลระบบ Demo', permissions: allPermissions },
      { username: 'staff', passwordHash: staffPass, role: Role.STAFF, name: 'เจ้าหน้าที่ Demo', permissions: allPermissions },
    ],
    skipDuplicates: true,
  });
  console.log('✅ Users created: demo/demo1234, staff/staff1234');

  // 3. Buildings + Rooms
  const usedPhones = new Set<string>();
  const allRooms: { id: string; buildingCode: string; roomNumber: string; rent: number }[] = [];

  for (const b of BUILDINGS) {
    const building = await prisma.building.create({
      data: { name: b.name, code: b.code, floors: b.floors },
    });

    for (let floor = 1; floor <= b.floors; floor++) {
      for (let r = 1; r <= b.roomsPerFloor; r++) {
        const roomNum = `${b.code}${floor}0${r}`;
        const rent = pick([3000, 3500, 4000, 4500, 5000, 5500, 6000]);
        const room = await prisma.room.create({
          data: {
            buildingId: building.id,
            number: roomNum,
            floor,
            pricePerMonth: rent,
            status: RoomStatus.VACANT,
          },
        });
        allRooms.push({ id: room.id, buildingCode: b.code, roomNumber: roomNum, rent });
      }
    }
  }
  console.log(`✅ ${allRooms.length} rooms created across ${BUILDINGS.length} buildings`);

  // 4. Tenants + Contracts + MeterReadings + Invoices + Payments
  // Leave last ~10 rooms vacant
  const occupiedRooms = allRooms.slice(0, allRooms.length - 10);

  const now = new Date();
  const MONTHS_BACK = 6;

  for (const room of occupiedRooms) {
    // Create tenant
    let phone: string;
    do { phone = randomPhone(); } while (usedPhones.has(phone));
    usedPhones.add(phone);

    const { name, nickname } = randomName();
    const isMovedOut = Math.random() < 0.08; // ~8% เป็น MOVED_OUT
    const tenant = await prisma.tenant.create({
      data: {
        name,
        nickname,
        phone,
        status: isMovedOut ? TenantStatus.MOVED_OUT : TenantStatus.ACTIVE,
      },
    });

    // Contract start date (3-18 months ago)
    const contractStartMonthsAgo = rand(3, 18);
    const contractStart = monthsAgo(contractStartMonthsAgo);

    const contract = await prisma.contract.create({
      data: {
        tenantId: tenant.id,
        roomId: room.id,
        startDate: contractStart,
        endDate: isMovedOut ? daysAgo(rand(30, 90)) : null,
        deposit: room.rent * 2,
        currentRent: room.rent,
        occupantCount: rand(1, 3),
        isActive: !isMovedOut,
      },
    });

    // Update room status
    await prisma.room.update({
      where: { id: room.id },
      data: { status: isMovedOut ? RoomStatus.VACANT : RoomStatus.OCCUPIED },
    });

    // Meter readings + invoices for last MONTHS_BACK months
    let prevWater = rand(100, 500);
    let prevElectric = rand(500, 2000);

    for (let m = MONTHS_BACK; m >= 1; m--) {
      const targetDate = monthsAgo(m);
      const month = targetDate.getMonth() + 1;
      const year = targetDate.getFullYear();

      const waterUsed = rand(15, 60);
      const electricUsed = rand(80, 350);
      const currWater = prevWater + waterUsed;
      const currElectric = prevElectric + electricUsed;

      await prisma.meterReading.upsert({
        where: { roomId_month_year: { roomId: room.id, month, year } },
        update: { waterReading: currWater, electricReading: currElectric },
        create: {
          roomId: room.id,
          month,
          year,
          waterReading: currWater,
          electricReading: currElectric,
          recordedBy: 'demo',
        },
      });

      const waterAmount = waterUsed * 18;
      const electricAmount = electricUsed * 8;
      const otherFees = 500; // common fee
      const total = room.rent + waterAmount + electricAmount + otherFees;

      const dueDate = new Date(year, month - 1, 5);
      const isPast = dueDate < now;

      let invoiceStatus: InvoiceStatus;
      if (m <= 1) {
        // เดือนล่าสุด — ส่วนใหญ่ยังรอชำระ
        invoiceStatus = Math.random() < 0.4 ? InvoiceStatus.PAID : InvoiceStatus.SENT;
      } else if (isPast) {
        const r = Math.random();
        if (r < 0.82) invoiceStatus = InvoiceStatus.PAID;
        else if (r < 0.93) invoiceStatus = InvoiceStatus.OVERDUE;
        else invoiceStatus = InvoiceStatus.SENT;
      } else {
        invoiceStatus = InvoiceStatus.SENT;
      }

      const invoice = await prisma.invoice.create({
        data: {
          contractId: contract.id,
          month,
          year,
          rentAmount: room.rent,
          waterAmount,
          electricAmount,
          otherFees,
          totalAmount: total,
          status: invoiceStatus,
          dueDate,
        },
      });

      // Payment records สำหรับ PAID invoices
      if (invoiceStatus === InvoiceStatus.PAID) {
        const paidDaysAfterDue = rand(-2, 8);
        const paidAt = new Date(dueDate);
        paidAt.setDate(paidAt.getDate() + paidDaysAfterDue);
        if (paidAt > now) paidAt.setDate(now.getDate() - 1);

        await prisma.payment.create({
          data: {
            invoiceId: invoice.id,
            amount: total,
            paidAt,
            verifiedBy: Math.random() < 0.3 ? 'AUTO' : 'demo',
            status: PaymentStatus.VERIFIED,
          },
        });
      }

      prevWater = currWater;
      prevElectric = currElectric;
    }
  }

  console.log(`✅ ${occupiedRooms.length} tenants + contracts + meter readings + invoices + payments created`);

  // 5. Maintenance requests (เพิ่มความสมจริง)
  const maintenanceTitles = [
    'แอร์ไม่เย็น', 'ก๊อกน้ำรั่ว', 'ไฟในห้องน้ำขาด', 'ประตูล็อคไม่ได้',
    'เครื่องทำน้ำอุ่นชำรุด', 'ผนังมีคราบน้ำ', 'ท่อน้ำอุดตัน', 'หลอดไฟฟ้าขาด',
    'พัดลมเพดานส่งเสียงดัง', 'ปลั๊กไฟใช้งานไม่ได้',
  ];
  const sampleRooms = occupiedRooms.slice(0, 15);
  for (const room of sampleRooms) {
    await prisma.maintenanceRequest.create({
      data: {
        roomId: room.id,
        title: pick(maintenanceTitles),
        status: pick(['PENDING', 'IN_PROGRESS', 'COMPLETED'] as const),
        reportedBy: 'ผู้เช่า',
        createdAt: daysAgo(rand(1, 60)),
      },
    });
  }
  console.log('✅ Maintenance requests created');

  const totalInvoices = await prisma.invoice.count();
  const totalPaid = await prisma.invoice.count({ where: { status: InvoiceStatus.PAID } });
  const totalTenants = await prisma.tenant.count();
  const totalRooms = await prisma.room.count();
  console.log('\n📊 Demo Data Summary:');
  console.log(`   Rooms: ${totalRooms} | Tenants: ${totalTenants}`);
  console.log(`   Invoices: ${totalInvoices} | Paid: ${totalPaid} | Pending: ${totalInvoices - totalPaid}`);
  console.log('\n🔑 Login credentials:');
  console.log('   Admin: demo / demo1234');
  console.log('   Staff: staff / staff1234');
  console.log('\n✅ Seed complete!');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
