import { PrismaClient, RoomStatus, Tenant } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

function parseCSV(input: string) {
  const lines = input.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const dataLines = lines;
  return dataLines.map((line) => {
    const cols: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ',' && !inQuotes) {
        cols.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    cols.push(cur);
    return cols.map((c) => c.trim());
  });
}

function parseDate(s?: string) {
  if (!s) return undefined;
  const trimmed = s.trim();
  if (!trimmed) return undefined;

  // Support both 7/4/2024 and 07/04/2024 styles
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return undefined;

  const d = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const y = Number(m[3]);
  return new Date(y, mo, d);
}

async function main() {
  const csvPathArg = process.argv.slice(2)[0];
  if (!csvPathArg) {
    process.exit(1);
  }
  const csvPath = path.resolve(csvPathArg);
  console.log(`Processing ${csvPath}`);
  const content = fs.readFileSync(csvPath, 'utf8');
  console.log(`File content length: ${content.length}`);
  const rows = parseCSV(content);
  console.log(`Parsed ${rows.length} rows`);
  const grouped: Record<
    string,
    Array<{
      roomNumber: string;
      fullName: string;
      nickname?: string;
      phone?: string;
      idCard?: string;
      startDate?: Date;
      endDate?: Date;
      floor?: number;
      building?: number;
    }>
  > = {};
  const header = rows[0] || [];
  const headerStr = Array.isArray(header) ? header.join(',') : '';
  const isNewFormat =
    /ชื่อห้อง/.test(headerStr) || /ชื่อ-นามสกุล/.test(headerStr) || header.length >= 7;
  const startIndex = isNewFormat ? 1 : 4;
  for (let idx = startIndex; idx < rows.length; idx++) {
    const cols = rows[idx];
    const roomRaw = isNewFormat ? String(cols[2] || '').trim() : cols[0];
    if (!roomRaw) continue;
    const buildingNum = isNewFormat ? Number(String(cols[0] || '').trim()) : undefined;
    const floorNum = isNewFormat ? Number(String(cols[1] || '').trim()) : undefined;
    const groupKey = isNewFormat
      ? `${isFinite(buildingNum!) ? buildingNum : 1}|${roomRaw}`
      : roomRaw;
    const roomNumber = groupKey;
    const fullName = isNewFormat ? (cols[3] || '') : (cols[1] || '');
    const nickname = isNewFormat ? (cols[4] || '') : (cols[2] || '');
    // Normalize phone to Thai local format: +66XXXXXXXXX or 66XXXXXXXXX -> 0XXXXXXXXX, ensure leading 0
    let phoneDigits = (isNewFormat ? (cols[5] || '') : (cols[3] || '')).replace(/[^0-9]/g, '');
    if (/^66/.test(phoneDigits)) {
      phoneDigits = '0' + phoneDigits.slice(2);
    }
    if (phoneDigits && phoneDigits[0] !== '0') {
      phoneDigits = '0' + phoneDigits;
    }
    const phone = phoneDigits;
    const idCard = (isNewFormat ? '' : (cols[6] || '').replace(/\s+/g, ''));
    const startDate = parseDate(isNewFormat ? cols[6] : cols[7]);
    const endDate = parseDate(isNewFormat ? undefined : cols[8]);
    const item = {
      roomNumber,
      fullName,
      nickname,
      phone,
      idCard,
      startDate,
      endDate,
      floor: isFinite(floorNum!) ? floorNum : undefined,
      building: isFinite(buildingNum!) ? buildingNum : undefined,
    };
    if (!grouped[roomNumber]) grouped[roomNumber] = [];
    grouped[roomNumber].push(item);
  }

  const roomNumbers = Object.keys(grouped);
  const seen: Record<string, Set<number>> = {};
  const meta: Record<string, { buildingId: string; floor: number }> = {};
  for (const rn of roomNumbers) {
    const pipeParts = rn.includes('|') ? rn.split('|') : null;
    const digitNameMatch = rn.match(/^(\d)\/(.+)$/);
    const slashOnlyMatch = rn.match(/^\/(.+)$/);
    const normalizedNumber = pipeParts
      ? pipeParts[1].trim()
      : digitNameMatch
        ? digitNameMatch[2].trim()
        : slashOnlyMatch
          ? slashOnlyMatch[1].trim()
          : rn;
    const records = grouped[rn];
    const inferredBuilding =
      records?.[0]?.building ??
      (pipeParts ? Number(pipeParts[0]) : digitNameMatch ? Number(digitNameMatch[1]) : slashOnlyMatch ? 1 : rn === '16' ? 1 : Number(rn[0]));
    const buildingDigit = isFinite(inferredBuilding) ? Number(inferredBuilding) : 1;
    const inferredFloor = records?.[0]?.floor;
    const buildingCode = `B${buildingDigit}`;
    let building = await prisma.building.findUnique({
      where: { code: buildingCode },
    });

    if (!building) {
      building = await prisma.building.create({
        data: {
          name: `ตึก ${buildingDigit}`,
          code: buildingCode,
          floors: 1,
        },
      });
    }
    const buildingId = building.id;

    let room = await prisma.room.findFirst({
      where: {
        number: normalizedNumber,
        buildingId: buildingId,
      },
    });
    if (!room) {
      room = await prisma.room.create({
        data: {
          number: normalizedNumber,
          floor: isFinite(inferredFloor!) ? Number(inferredFloor) : 1,
          pricePerMonth: 3500,
          status: RoomStatus.VACANT,
          buildingId: buildingId,
        },
      });
    } else {
      await prisma.room.update({
        where: { id: room.id },
        data: {
          buildingId: buildingId,
          floor: isFinite(inferredFloor!) ? Number(inferredFloor) : room.floor,
        },
      });
    }
    const key = `${buildingDigit}-${isFinite(inferredFloor!) ? Number(inferredFloor) : 1}`;
    const numVal = Number(normalizedNumber);
    if (!Number.isNaN(numVal)) {
      if (!seen[key]) seen[key] = new Set<number>();
      seen[key].add(numVal);
      if (!meta[key]) meta[key] = { buildingId, floor: isFinite(inferredFloor!) ? Number(inferredFloor) : 1 };
    }
    // Filter out rows that have only a room number but no occupant information.
    // ตาม requirement: ถ้าเจอห้องที่ไม่มีข้อมูล = ห้องว่าง
    const validRecords = records.filter((r) => {
      const hasName = r.fullName && r.fullName.trim().length > 0;
      const hasPhone = r.phone && r.phone.trim().length > 0;
      return hasName || hasPhone;
    });

    // No tenant info for this room => keep room as VACANT and skip contract creation
    if (validRecords.length === 0) {
      await prisma.room.update({
        where: { id: room.id },
        data: { status: RoomStatus.VACANT },
      });
      continue;
    }

    validRecords.sort((a, b) => {
      const ad = a.startDate?.getTime() ?? 0;
      const bd = b.startDate?.getTime() ?? 0;
      const diff = bd - ad;
      if (diff !== 0) return diff;
      
      // If dates are equal, prefer the one with a phone number
      const aHasPhone = a.phone && a.phone.length > 0;
      const bHasPhone = b.phone && b.phone.length > 0;
      if (aHasPhone && !bHasPhone) return -1;
      if (!aHasPhone && bHasPhone) return 1;
      
      return 0;
    });
    // Create tenants and link contracts:
    // - Latest record becomes the active contract
    // - Older records become inactive contracts (history) to keep linkage
    
    // Pre-fetch existing contracts to prevent duplicates
    const existingContracts = await prisma.contract.findMany({
      where: { roomId: room.id },
      include: { tenant: true }
    });

    for (let idx = 0; idx < validRecords.length; idx++) {
      const rec = validRecords[idx];
      const phoneKey = rec.phone || undefined;
      const tenantName = rec.fullName;
      let tenant: Tenant;
      if (phoneKey) {
        try {
          tenant = await prisma.tenant.upsert({
            where: { phone: phoneKey },
            update: { name: tenantName, nickname: rec.nickname || undefined },
            create: {
              name: tenantName,
              nickname: rec.nickname || undefined,
              phone: phoneKey,
            },
          });
        } catch {
          const existingByName = await prisma.tenant.findFirst({
            where: { name: tenantName },
          });
          tenant =
            existingByName ??
            (await prisma.tenant.create({
              data: {
                name: tenantName,
                nickname: rec.nickname || undefined,
                phone: `NA-${Date.now()}-${Math.random()}`,
              },
            }));
        }
      } else {
        const existingByName = await prisma.tenant.findFirst({
          where: { name: tenantName },
        });
        tenant =
          existingByName ??
          (await prisma.tenant.create({
            data: {
              name: tenantName,
              nickname: rec.nickname || undefined,
              phone: `NA-${Date.now()}-${Math.random()}`,
            },
          }));
      }

      const isActive = idx === 0 && (!rec.endDate || rec.endDate.getTime() > Date.now());
      
      // Check if equivalent contract exists
      const existingMatch = existingContracts.find(c => {
        if (c.tenantId !== tenant.id) return false;
        // If CSV has start date, require match
        if (rec.startDate) {
           return Math.abs(c.startDate.getTime() - rec.startDate.getTime()) < 1000;
        }
        // If CSV has NO start date (generated), assume match if it's the active one 
        // or if we just want to avoid duplicating the same tenant with generated dates
        return true; 
      });

      if (existingMatch) {
        // If contract exists, ensure status is correct
        if (isActive && !existingMatch.isActive) {
           // Reactivate
           await prisma.contract.update({ where: { id: existingMatch.id }, data: { isActive: true } });
           // Ensure others are inactive
           await prisma.contract.updateMany({
             where: { roomId: room.id, id: { not: existingMatch.id }, isActive: true },
             data: { isActive: false }
           });
        } else if (!isActive && existingMatch.isActive) {
           await prisma.contract.update({ where: { id: existingMatch.id }, data: { isActive: false } });
        }
        continue;
      }

      // If creating new active contract, deactivate others first
      if (isActive) {
        await prisma.contract.updateMany({
          where: { roomId: room.id, isActive: true },
          data: { isActive: false },
        });
      }

      await prisma.contract.create({
        data: {
          tenantId: tenant.id,
          roomId: room.id,
          startDate: rec.startDate ?? new Date(),
          endDate: rec.endDate,
          deposit: room.pricePerMonth ?? 0,
          currentRent: room.pricePerMonth ?? 0,
          occupantCount: validRecords.length || 1,
          isActive,
        },
      });
    }
    await prisma.room.update({
      where: { id: room.id },
      data: { status: RoomStatus.OCCUPIED },
    });
  }

  const keys = Object.keys(seen);
  for (const k of keys) {
    const info = meta[k];
    if (!info) continue;
    const base = (info.floor - 1) * 10;
    for (let i = 1; i <= 10; i++) {
      const expected = base + i;
      if (!seen[k].has(expected)) {
        const exists = await prisma.room.findFirst({
          where: { buildingId: info.buildingId, number: String(expected) },
          select: { id: true },
        });
        if (!exists) {
          await prisma.room.create({
            data: {
              number: String(expected),
              floor: info.floor,
              pricePerMonth: 3500,
              status: RoomStatus.VACANT,
              buildingId: info.buildingId,
            },
          });
        }
      }
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
