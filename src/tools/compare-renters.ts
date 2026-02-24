import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config();

const prisma = new PrismaClient();

type ExcelRoomKey = string;

function normalizeExcelCode(value: unknown): ExcelRoomKey | null {
  if (value == null) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const slashCount = (raw.match(/\//g) || []).length;
  const slashMatch =
    slashCount === 1 ? raw.match(/^(\d+)\s*\/\s*([^/]+)$/) : null;
  if (slashMatch) {
    const b = slashMatch[1];
    const room = slashMatch[2].trim();
    if (!b || !room) return null;
    return `${parseInt(b, 10)}/${room}`;
  }

  const digitsOnly = raw.replace(/\s+/g, '');
  if (/^\d+$/.test(digitsOnly) && digitsOnly.length >= 2) {
    const b = digitsOnly[0];
    let remainder = digitsOnly.slice(1);
    remainder = remainder.replace(/^0+/, '');
    if (!remainder) return `${parseInt(b, 10)}/0`;
    if (!/^\d{1,2}$/.test(remainder)) return null;
    return `${parseInt(b, 10)}/${remainder}`;
  }

  return null;
}

async function getDbRoomKeys(): Promise<{
  keys: Set<ExcelRoomKey>;
  byKey: Map<ExcelRoomKey, { roomId: string; status: string }>;
}> {
  const rooms = await prisma.room.findMany({
    include: {
      building: true,
      contracts: { where: { isActive: true }, take: 1 },
    },
  });
  const keys = new Set<ExcelRoomKey>();
  const byKey = new Map<ExcelRoomKey, { roomId: string; status: string }>();
  for (const r of rooms) {
    const buildingName = r.building?.name ?? '';
    const m = buildingName.match(/(\d+)/);
    const buildingNum = m ? parseInt(m[1], 10) : NaN;
    if (!Number.isFinite(buildingNum)) continue;
    const k: ExcelRoomKey = `${buildingNum}/${r.number}`;
    keys.add(k);
    const status = r.status;
    byKey.set(k, { roomId: r.id, status });
  }
  return { keys, byKey };
}

function readExcelRoomKeys(xlsPath: string): {
  keys: Set<ExcelRoomKey>;
  counts: Map<ExcelRoomKey, number>;
} {
  const wb = XLSX.readFile(xlsPath);
  const firstSheetName = wb.SheetNames[0];
  const ws = wb.Sheets[firstSheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
  });
  const keys = new Set<ExcelRoomKey>();
  const counts = new Map<ExcelRoomKey, number>();
  const isValidKey = (k: ExcelRoomKey): boolean => {
    const [bStr, room] = k.split('/', 2);
    const b = Number(bStr);
    if (!Number.isFinite(b) || b < 1 || b > 6) return false;
    if (!room || room.includes('/')) return false;
    if (/^\d+$/.test(room)) {
      return room.length >= 1 && room.length <= 2;
    }
    return /^[^0-9]+$/.test(room) && room.length <= 20;
  };
  for (const row of rows) {
    for (const cell of row) {
      const k = normalizeExcelCode(cell);
      if (k && isValidKey(k)) {
        keys.add(k);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
  }
  return { keys, counts };
}

function readCsvRoomKeys(csvPath: string): { keys: Set<ExcelRoomKey> } {
  const keys = new Set<ExcelRoomKey>();
  try {
    const raw = fs.readFileSync(csvPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const parts = line.split(',');
      if (parts.length < 3) continue;
      const building = (parts[0] || '').trim();
      const roomName = (parts[2] || '').trim();
      if (!building || !roomName) continue;
      const bNum = Number(building);
      if (!Number.isFinite(bNum)) continue;
      const key: ExcelRoomKey = `${bNum}/${roomName}`;
      keys.add(key);
    }
  } catch (err) {
    console.warn('อ่าน CSV ไม่สำเร็จ:', (err as Error)?.message || String(err));
  }
  return { keys };
}

async function main() {
  const excelPath = '/root/renters_23_02_2026, 23_01น..xls';
  if (!fs.existsSync(excelPath)) {
    console.error(`ไม่พบไฟล์ Excel: ${excelPath}`);
    process.exit(1);
  }

  const excel = readExcelRoomKeys(excelPath);
  let db: {
    keys: Set<ExcelRoomKey>;
    byKey: Map<ExcelRoomKey, { roomId: string; status: string }>;
  };
  try {
    db = await getDbRoomKeys();
  } catch {
    const csvFallback = '/root/uploads/renters.csv';
    const fallback = readCsvRoomKeys(csvFallback);
    db = { keys: fallback.keys, byKey: new Map() };
    console.warn(
      'เชื่อมต่อฐานข้อมูลไม่ได้ ใช้ข้อมูลจาก renters.csv แทนในการเทียบ',
    );
  }

  const missingInDb: ExcelRoomKey[] = [];
  for (const k of excel.keys) {
    if (!db.keys.has(k)) missingInDb.push(k);
  }

  const extraInDb: ExcelRoomKey[] = [];
  for (const k of db.keys) {
    if (!excel.keys.has(k)) extraInDb.push(k);
  }

  const duplicatesInExcel: ExcelRoomKey[] = [];
  for (const [k, c] of excel.counts.entries()) {
    if (c > 1) duplicatesInExcel.push(k);
  }

  const b4r7Key: ExcelRoomKey = '4/7';
  const b4r7Db = db.byKey.get(b4r7Key);
  let b4r7ContractActive = false;
  let b4r7Status: string | undefined = undefined;
  if (b4r7Db) {
    b4r7Status = b4r7Db.status;
    const activeContract = await prisma.contract.findFirst({
      where: { roomId: b4r7Db.roomId, isActive: true },
    });
    b4r7ContractActive = !!activeContract;
  }

  const result = {
    excelRoomCount: excel.keys.size,
    dbRoomCount: db.keys.size,
    missingInDb: missingInDb.sort(),
    extraInDb: extraInDb.sort(),
    duplicatesInExcel: duplicatesInExcel.sort(),
    b4r7: {
      existsInDb: !!b4r7Db,
      status: b4r7Status ?? null,
      hasActiveContract: b4r7ContractActive,
      existsInExcel: excel.keys.has(b4r7Key),
    },
  };

  const outPath = path.join('/root', 'compare_result.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(JSON.stringify(result, null, 2));
  console.log(`ผลลัพธ์ถูกบันทึกที่: ${outPath}`);
}

main()
  .catch((err) => {
    console.error('เกิดข้อผิดพลาด:', (err as Error)?.message || String(err));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
