# Migration: Uploads แยกตามหอ (tenant)

## สรุปการตรวจสอบ (เช็คแล้ว)

| รายการ | ค่า |
|--------|-----|
| **Host uploads** | `/root/uploads` (มีรูปเก่าทั้งหมดแบบ flat) |
| **Container** | volume `/root/uploads` → `/app/uploads`, cwd=/app |
| **TENANT_ID (sisomapt)** | `32f4b8a2-9296-4409-bd48-1b90daa22be9` |
| **Dry run (local)** | 101 image URLs ใน DB, 101 ไฟล์จะถูก copy, 101 แถวจะอัปเดต |

## รัน migration จริง (sisom on prod)

**หมายเหตุ:** บน production ใช้รหัสผ่าน DB จริงจาก `.env` (ไม่ใช่ `password` ถ้าเปลี่ยนแล้ว)

```bash
cd /root/sisom-be

# 1) Dry run ก่อน (ไม่ copy ไม่อัปเดต DB)
UPLOAD_DIR=/root/uploads \
TENANT_DB_URL="postgresql://admin:<รหัสผ่านจริง>@127.0.0.1:5433/sisomapt?schema=public" \
TENANT_ID="32f4b8a2-9296-4409-bd48-1b90daa22be9" \
DRY_RUN=1 \
npx ts-node -r tsconfig-paths/register scripts/migrate-uploads-by-tenant.ts

# 2) รันจริง
UPLOAD_DIR=/root/uploads \
TENANT_DB_URL="postgresql://admin:<รหัสผ่านจริง>@127.0.0.1:5433/sisomapt?schema=public" \
TENANT_ID="32f4b8a2-9296-4409-bd48-1b90daa22be9" \
npx ts-node -r tsconfig-paths/register scripts/migrate-uploads-by-tenant.ts
```

หลังรันเสร็จ สคริปต์จะ verify ว่า path ใน DB ชี้ไปที่ไฟล์ที่มีอยู่จริง
