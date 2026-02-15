import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

function parseCSV(input: string) {
  const lines = input.split(/\r?\n/).filter(l => l.trim().length > 0)
  const dataLines = lines.map(line => {
    const cols: string[] = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { inQuotes = !inQuotes; continue }
      if (ch === ',' && !inQuotes) { cols.push(cur); cur = '' } else { cur += ch }
    }
    cols.push(cur)
    return cols.map(c => c.trim())
  })
  return dataLines
}

function inferMonthYear(filePath: string) {
  const base = path.basename(filePath)
  const m = base.match(/_(\d{1,2})-(\d{4})/)
  if (m) return { month: parseInt(m[1], 10), year: parseInt(m[2], 10) }
  const now = new Date()
  return { month: now.getMonth() + 1, year: now.getFullYear() }
}

async function main() {
  const argv = process.argv.slice(2)
  const csvPathArg = argv[0]
  if (!csvPathArg) process.exit(1)
  const csvPath = path.resolve(csvPathArg)
  const content = fs.readFileSync(csvPath, 'utf8')
  const rows = parseCSV(content)
  const header = rows[0] || []
  const isHeader = Array.isArray(header) && /หอ/.test(header.join(','))
  const startIdx = isHeader ? 1 : 0
  const overrideMonthArg = argv.find(a => a.startsWith('--month='))
  const overrideYearArg = argv.find(a => a.startsWith('--year='))
  const inferred = inferMonthYear(csvPath)
  const month = overrideMonthArg ? parseInt(overrideMonthArg.split('=')[1], 10) : inferred.month
  const year = overrideYearArg ? parseInt(overrideYearArg.split('=')[1], 10) : inferred.year

  for (let i = startIdx; i < rows.length; i++) {
    const cols = rows[i]
    const buildingNum = parseInt(String(cols[0] || '1').trim(), 10)
    const floorNum = parseInt(String(cols[1] || '1').trim(), 10)
    const roomNumRaw = String(cols[2] || '').trim()
    if (!roomNumRaw) continue
    const waterPrev = parseFloat(String(cols[3] || '0').trim() || '0')
    const waterCur = parseFloat(String(cols[4] || '0').trim() || '0')
    const elecPrev = parseFloat(String(cols[5] || '0').trim() || '0')
    const elecCur = parseFloat(String(cols[6] || '0').trim() || '0')

    const buildingCode = `B${Number.isFinite(buildingNum) ? buildingNum : 1}`
    let building = await prisma.building.findUnique({ where: { code: buildingCode } })
    if (!building) {
      building = await prisma.building.create({
        data: { name: `ตึก ${buildingNum}`, code: buildingCode, floors: 1 },
      })
    }

    const number = roomNumRaw
    let room = await prisma.room.findFirst({
      where: { buildingId: building.id, number },
    })
    if (!room) {
      room = await prisma.room.create({
        data: {
          number,
          floor: Number.isFinite(floorNum) ? floorNum : 1,
          status: 'VACANT',
          buildingId: building.id,
          pricePerMonth: 3500,
        },
      })
    } else {
      await prisma.room.update({
        where: { id: room.id },
        data: { floor: Number.isFinite(floorNum) ? floorNum : room.floor, buildingId: building.id },
      })
    }

    let prevM = month - 1
    let prevY = year
    if (prevM === 0) { prevM = 12; prevY = year - 1 }

    if (Number.isFinite(waterPrev) || Number.isFinite(elecPrev)) {
      await prisma.meterReading.upsert({
        where: { roomId_month_year: { roomId: room.id, month: prevM, year: prevY } },
        update: {
          waterReading: Number.isFinite(waterPrev) ? waterPrev : 0,
          electricReading: Number.isFinite(elecPrev) ? elecPrev : 0,
        },
        create: {
          roomId: room.id,
          month: prevM,
          year: prevY,
          waterReading: Number.isFinite(waterPrev) ? waterPrev : 0,
          electricReading: Number.isFinite(elecPrev) ? elecPrev : 0,
        },
      })
    }

    await prisma.meterReading.upsert({
      where: { roomId_month_year: { roomId: room.id, month, year } },
      update: {
        waterReading: Number.isFinite(waterCur) ? waterCur : 0,
        electricReading: Number.isFinite(elecCur) ? elecCur : 0,
      },
      create: {
        roomId: room.id,
        month,
        year,
        waterReading: Number.isFinite(waterCur) ? waterCur : 0,
        electricReading: Number.isFinite(elecCur) ? elecCur : 0,
      },
    })
  }
}

main()
  .then(async () => { await prisma.$disconnect() })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
