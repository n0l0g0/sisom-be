/**
 * Migrate uploads to per-tenant folders (uploads/{tenantId}/).
 * - Reads Tenant.idCardImageUrl, Contract.contractImageUrl, Payment.slipImageUrl from tenant DB
 * - Copies each file from uploads/filename to uploads/{tenantId}/filename
 * - Updates DB with new URL path (tenantId/filename)
 *
 * TENANT_ID = UUID of the dorm in owner13rent (X-Tenant-Id). Get from owner DB:
 *   SELECT id FROM "Tenant" WHERE slug = 'sisomapt';
 *
 * Usage (on server, where /root/uploads and tenant DB are available):
 *   UPLOAD_DIR=/root/uploads \
 *   TENANT_DB_URL="postgresql://admin:password@127.0.0.1:5433/sisomapt?schema=public" \
 *   TENANT_ID="<uuid-from-owner-Tenant-table>" \
 *   npx ts-node -r tsconfig-paths/register scripts/migrate-uploads-by-tenant.ts
 *
 * Dry run (no copy, no DB update):
 *   DRY_RUN=1 ... npx ts-node ...
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
const TENANT_DB_URL =
  process.env.TENANT_DB_URL || process.env.DATABASE_URL;
const TENANT_ID = process.env.TENANT_ID;
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

function extractFilenameFromUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const u = url.trim();
  if (!u) return null;
  // .../api/media/xxx or .../api/media/tenantId/xxx or https://host/api/media/xxx
  const match = u.match(/\/api\/media\/(.+)$/);
  const segment = match ? match[1] : u;
  // If already tenantId/filename, take as-is; else it's just filename
  return segment || null;
}

function isLegacyPath(relativePath: string): boolean {
  return !relativePath.includes('/');
}

async function main() {
  if (!TENANT_DB_URL) {
    console.error('TENANT_DB_URL or DATABASE_URL required');
    process.exit(1);
  }
  if (!TENANT_ID) {
    console.error(
      'TENANT_ID required (UUID of dorm in owner Tenant table). Example: SELECT id FROM "Tenant" WHERE slug = \'sisomapt\';',
    );
    process.exit(1);
  }
  const tenantId = TENANT_ID;
  console.log(`Tenant ID: ${tenantId}`);
  console.log(`Upload base dir: ${UPLOAD_DIR}`);
  console.log(`Dry run: ${DRY_RUN}`);

  const prisma = new PrismaClient({
    datasources: { db: { url: TENANT_DB_URL } },
  });

  const tenantDir = path.join(UPLOAD_DIR, tenantId);
  if (!DRY_RUN && !fs.existsSync(tenantDir)) {
    fs.mkdirSync(tenantDir, { recursive: true });
    console.log(`Created ${tenantDir}`);
  }

  type Row = { id: string; url: string | null; table: string };
  const rows: Row[] = [];

  const tenants = await prisma.tenant.findMany({
    where: { idCardImageUrl: { not: null } },
    select: { id: true, idCardImageUrl: true },
  });
  for (const t of tenants) {
    if (t.idCardImageUrl) rows.push({ id: t.id, url: t.idCardImageUrl, table: 'Tenant' });
  }

  const contracts = await prisma.contract.findMany({
    where: { contractImageUrl: { not: null } },
    select: { id: true, contractImageUrl: true },
  });
  for (const c of contracts) {
    if (c.contractImageUrl)
      rows.push({ id: c.id, url: c.contractImageUrl, table: 'Contract' });
  }

  const payments = await prisma.payment.findMany({
    where: { slipImageUrl: { not: null } },
    select: { id: true, slipImageUrl: true },
  });
  for (const p of payments) {
    if (p.slipImageUrl)
      rows.push({ id: p.id, url: p.slipImageUrl, table: 'Payment' });
  }

  console.log(`Found ${rows.length} image URL(s) in DB`);

  const urlToNewPath = new Map<string, string>();
  const copyList: { from: string; to: string; relativePath: string }[] = [];

  for (const row of rows) {
    const relativePath = extractFilenameFromUrl(row.url);
    if (!relativePath) continue;
    if (!isLegacyPath(relativePath)) {
      continue;
    }
    const fromPath = path.join(UPLOAD_DIR, relativePath);
    if (!fs.existsSync(fromPath)) {
      console.warn(`File not found (skip): ${fromPath}`);
      continue;
    }
    const newRelativePath = `${tenantId}/${path.basename(relativePath)}`;
    const toPath = path.join(UPLOAD_DIR, newRelativePath);
    urlToNewPath.set(row.url!, newRelativePath);
    if (!copyList.some((c) => c.from === fromPath)) {
      copyList.push({ from: fromPath, to: toPath, relativePath: newRelativePath });
    }
  }

  console.log(`Will copy ${copyList.length} unique file(s) to ${tenantId}/`);

  for (const { from, to, relativePath } of copyList) {
    if (DRY_RUN) {
      console.log(`[DRY] would copy ${from} -> ${to}`);
      continue;
    }
    fs.copyFileSync(from, to);
    console.log(`Copied: ${relativePath}`);
  }

  const baseUrlReplace = (url: string, newPath: string): string => {
    const match = url.match(/^(.+\/api\/media\/)[^/]*(?:\/[^/]*)?$/);
    if (match) return url.replace(/\/api\/media\/.+$/, `/api/media/${newPath}`);
    return url.replace(/[^/]+$/, newPath);
  };

  let updated = 0;
  for (const row of rows) {
    const newPath = urlToNewPath.get(row.url!);
    if (!newPath) continue;
    const newUrl = baseUrlReplace(row.url!, newPath);
    if (row.url === newUrl) continue;

    if (DRY_RUN) {
      console.log(`[DRY] would update ${row.table} ${row.id}: ${row.url} -> ${newUrl}`);
      updated++;
      continue;
    }

    if (row.table === 'Tenant') {
      await prisma.tenant.update({
        where: { id: row.id },
        data: { idCardImageUrl: newUrl },
      });
    } else if (row.table === 'Contract') {
      await prisma.contract.update({
        where: { id: row.id },
        data: { contractImageUrl: newUrl },
      });
    } else if (row.table === 'Payment') {
      await prisma.payment.update({
        where: { id: row.id },
        data: { slipImageUrl: newUrl },
      });
    }
    updated++;
    console.log(`Updated ${row.table} ${row.id}`);
  }

  console.log(`Done. Updated ${updated} row(s).`);

  if (!DRY_RUN && updated > 0) {
    console.log('Verifying: checking that image paths exist...');
    const all = [
      ...(await prisma.tenant.findMany({ select: { idCardImageUrl: true } })),
      ...(await prisma.contract.findMany({ select: { contractImageUrl: true } })),
      ...(await prisma.payment.findMany({ select: { slipImageUrl: true } })),
    ];
    const urls = all
      .map((r: { idCardImageUrl?: string | null; contractImageUrl?: string | null; slipImageUrl?: string | null }) =>
        (r as Record<string, string | null>).idCardImageUrl ?? (r as Record<string, string | null>).contractImageUrl ?? (r as Record<string, string | null>).slipImageUrl)
      .filter(Boolean) as string[];
    let missing = 0;
    for (const url of urls) {
      const rel = extractFilenameFromUrl(url);
      if (!rel) continue;
      const full = path.join(UPLOAD_DIR, rel);
      if (!fs.existsSync(full)) {
        console.warn(`Missing file: ${full} (url: ${url})`);
        missing++;
      }
    }
    if (missing === 0) console.log('All image paths verified.');
    else console.warn(`${missing} file(s) missing on disk.`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
