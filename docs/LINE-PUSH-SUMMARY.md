# สรุป: จุดที่ส่ง LINE อัตโนมัติ และทางลดการใช้งานโควต้า

ข้อความที่ส่งด้วย **reply token** (ตอบภายในเหตุการณ์ที่ user ส่งมา) **ไม่นับโควต้า push**  
ข้อความที่ส่งด้วย **push message / pushFlex** **นับโควต้ารายเดือน** ของ LINE Official Account

---

## 1. Cron / งาน定时 (ส่งตามเวลา)

| จุด | ไฟล์ | เวลา | ส่งไปที่ | จำนวนโดยประมาณ |
|-----|------|------|----------|------------------|
| **แจ้งเตือนวันนัดชำระ** | `invoices.service.ts` → `notifyPaymentSchedules()` | ทุกวัน 09:00 (`0 9 * * *`) | ผู้เช่าแต่ละห้อง (1 ข้อความ/ห้อง) + Staff ทุกคน (Flex 1 ข้อความ/คน ต่อห้องที่ตรงวันนัด | มากถ้ามีหลายห้อง + หลาย staff |
| **ย้ายออกตามวันที่** | `line.service.ts` → `notifyMoveoutForDate()` | เรียกจาก API `POST /api/line/notify-moveout-due` (ไม่มี cron ในโค้ด) | Admin/Owner ที่มี `line_notifications` | 1 ข้อความ/คน |

**ทางลด**
- **ปิดหรือเลื่อนแจ้งเตือนวันนัดชำระ**
  - ใน `invoices.service.ts` ฟังก์ชัน `onModuleInit()` มี `cron.schedule('0 9 * * *', ... notifyPaymentSchedules)`  
  - **ทำได้:** comment หรือลบ schedule นี้ หรือเปลี่ยนเป็นรันแค่เมื่อกดปุ่ม (มี API `POST /api/invoices/schedules/notify/run` อยู่แล้ว)
- **ลดผู้รับแจ้งเตือน staff**
  - `getStaffNotifyTargets()` / `getLineNotifyTargets()` ดึงเฉพาะ user ที่มี permission `line_notifications`
  - **ทำได้:** ถอดสิทธิ์ `line_notifications` จากบางคนในระบบ จะไม่ถูก push แจ้งเตือน

---

## 2. เมื่อมีการชำระเงิน (Verify สลิป)

| จุด | ไฟล์ | เหตุการณ์ | ส่งไปที่ |
|-----|------|-----------|----------|
| **แจ้งผู้เช่าว่าตัดยอดแล้ว** | `payments.service.ts` | อัปเดต payment เป็น VERIFIED | ผู้เช่าห้องนั้น (1 ข้อความ) |
| **แจ้ง staff ว่ามีการชำระ** | `invoices.service.ts` → `notifyStaffPaymentVerified()` | หลัง verify สลิป | ทุก Staff/Admin/Owner ที่มี `line_notifications` (1 ข้อความ/คน) |
| **แจ้ง staff (ข้อความสรุป)** | `payments.service.ts` → `notifyStaffPaymentSuccess()` | หลัง verify สลิป | ทุก Admin/Owner ที่มี `line_notifications` (1 ข้อความ/คน) |
| **แจ้งผู้เช่าเมื่อปฏิเสธสลิป** | `payments.service.ts` | อัปเดต payment เป็น REJECTED | ผู้เช่าห้องนั้น (Flex หรือ text 1 ข้อความ) |
| **เงินประกัน (ย้ายออก)** | `invoices.service.ts` | Verify สลิปแบบ DEPOSIT | ผู้เช่าห้องนั้น (1 ข้อความ) |

**ทางลด**
- ปิดการ push ให้ **ผู้เช่า**: comment การเรียก `lineService.pushMessage(tenant.lineUserId, ...)` ใน `payments.service.ts` (และส่วน deposit ใน `invoices.service.ts` ถ้าไม่ต้องการแจ้งประกัน)
- ปิดการ push ให้ **staff**: comment การเรียก `notifyStaffPaymentVerified` ใน `invoices.service.ts` และ `notifyStaffPaymentSuccess` ใน `payments.service.ts`
- หรือลดจำนวน staff ที่ได้รับ: ใช้สิทธิ์ `line_notifications` เฉพาะคนที่จำเป็น

---

## 3. แจ้งซ่อม / แจ้งย้ายออก

| จุด | ไฟล์ | เหตุการณ์ | ส่งไปที่ |
|-----|------|-----------|----------|
| **มีแจ้งซ่อมใหม่** | `line.service.ts` → `notifyStaffMaintenanceCreated()` | สร้าง maintenance request | ทุก Admin/Owner ที่มี `line_notifications` (1 Flex/คน) |
| **มีแจ้งย้ายออกใหม่** | `line.service.ts` → `notifyStaffMoveoutCreated()` | สร้าง maintenance ประเภทแจ้งย้ายออก | ทุก Admin/Owner ที่มี `line_notifications` (1 Flex/คน) |
| **แจ้งผู้เช่า: ซ่อมเสร็จ** | `line.service.ts` → `notifyTenantMaintenanceCompleted()` | อัปเดต maintenance เป็น COMPLETED | ผู้เช่าห้องนั้น (1 ข้อความ) |

เรียกจาก: `maintenance.service.ts` (ตอนสร้าง/อัปเดตรายการ)

**ทางลด**
- ปิดแจ้ง staff: comment การเรียก `notifyStaffMaintenanceCreated` และ `notifyStaffMoveoutCreated` ใน `maintenance.service.ts`
- ปิดแจ้งผู้เช่าเมื่อซ่อมเสร็จ: comment การเรียก `notifyTenantMaintenanceCompleted` ใน `maintenance.service.ts`

---

## 4. การเชื่อมบัญชี LINE (Link room)

| จุด | ไฟล์ | เหตุการณ์ | ส่งไปที่ |
|-----|------|-----------|----------|
| **เชื่อมบัญชีสำเร็จ** | `line.service.ts` → `acceptLink()` | Staff กดยืนยันเชื่อมห้อง | User ที่เชื่อม (1 ข้อความ) |
| **ยกเลิกคำขอเชื่อม** | `line.service.ts` → `rejectLink()` | Staff กดปฏิเสธ | User ที่ขอเชื่อม (1 ข้อความ) |

**ทางลด**
- ได้แต่ลดความถี่การใช้งาน (ไม่มี cron) หรือเปลี่ยนเป็นแจ้งในแอปแทน ถ้าต้องการลด push จริงๆ ต้อง comment ใน `acceptLink` / `rejectLink`

---

## 5. Timeout / Flow ภายใน LINE (หลัง user กดหรือส่งข้อความ)

| จุด | ไฟล์ (line.service.ts) | เหตุการณ์ | ส่งไปที่ |
|-----|------------------------|-----------|----------|
| หมดเวลาส่งสลิป | setTimeout callback | User เลือกห้องแล้วไม่ส่งสลิปภายในเวลา | User นั้น (1 ข้อความ) |
| หมดเวลาส่งรูปแจ้งย้ายออก | setTimeout callback | กำลังแจ้งย้ายออกแต่ไม่ส่งรูปภายในเวลา | User นั้น (1 ข้อความ) |
| Staff payment flow timeouts | หลายจุด | Staff เริ่ม flow ชำระเงินแต่ไม่ทำต่อภายในเวลา | Staff (1 ข้อความ) |
| MOVEOUT_DAYS postback | handleEvent | User เลือกจำนวนวันโอนประกัน | User (1 ข้อความ) |
| แจ้งข้อมูลบัญชีรับคืน | handleEvent (ย้ายออก) | หลังบันทึกวันที่ย้ายออก | User (2 ข้อความ: info + bank) |

**ทางลด**
- ลดเวลา timeout หรือไม่ส่งข้อความเมื่อ timeout (แก้ใน `line.service.ts` แต่ละจุดที่ `pushMessage` ใน setTimeout)
- ข้อความประเภท “เลือกวันโอนประกัน” / “แจ้งบัญชี” เป็นส่วนหนึ่งของ flow ถ้าปิด user จะไม่รู้ว่าต้องทำอะไรต่อ

---

## 6. จุดอื่นที่ push (จาก flow ใน LINE หรือ API)

- **Staff เลือกตึก/ห้องชำระเงิน**: push ข้อความแจ้งรายการบิล, ไม่มีบิล, ฯลฯ
- **ผู้เช่าเลือกรายละเอียดห้องพัก / บิล / รูปห้อง ฯลฯ**: push Flex/ข้อความตามเมนู
- **Ping จากระบบ**: `GET /api/line/ping/:userId` (ใช้ทดสอบ)
- **Push ด้วยมือ**: `POST /api/line/push` body `{ userId, text }`

การส่งเหล่านี้เกิดเมื่อ **มีคนใช้งาน** (กดเมนูหรือเรียก API) ไม่ใช่ส่งรัวๆ ตามเวลา

---

## สรุปทางลดที่ทำได้ง่าย

1. **ปิดหรือลด “แจ้งเตือนวันนัดชำระ” (ใช้โคว้ามากถ้าห้องเยอะ)**
   - ปิด cron: ใน `invoices.service.ts` → `onModuleInit()` comment บรรทัด `cron.schedule('0 9 * * *', ... notifyPaymentSchedules)`
   - หรือไม่รันอัตโนมัติ: ใช้แค่ปุ่ม/API `POST /api/invoices/schedules/notify/run` เมื่อต้องการแจ้งจริง

2. **ลดการแจ้ง staff (แยกตามหัวข้อ)**
   - ใน **ตั้งค่า → จัดการผู้ใช้** แก้ไข User แล้วติ๊กเฉพาะประเภทแจ้งเตือน LINE ที่ต้องการ:
     - **แจ้งเมื่อยืนยันสลิปชำระเงิน** (`line_notify_payment_verified`)
     - **แจ้งเมื่อมีการชำระเงิน** (`line_notify_payment_success`)
     - **แจ้งเมื่อมีแจ้งซ่อมใหม่** (`line_notify_maintenance_created`)
     - **แจ้งเมื่อมีแจ้งย้ายออก / รายการย้ายออก** (`line_notify_moveout_created`)
   - ถ้า User ยังมีสิทธิ์เก่า `line_notifications` อยู่ จะถือว่าได้รับทุกประเภท (เทียบเท่าติ๊กครบทั้ง 4)

3. **ลดการแจ้งผู้เช่า (ถ้ายอมได้)**
   - Comment การ push ให้ผู้เช่าใน `payments.service.ts` (verify/reject)
   - Comment การ push เงินประกันใน `invoices.service.ts`
   - Comment `notifyTenantMaintenanceCompleted` ใน `maintenance.service.ts`

4. **ตรวจโคว้า LINE**
   - LINE Developers Console → Channel → ดูการใช้งานข้อความรายเดือน

ไฟล์หลักที่แก้ถ้าต้องการปิด/ลด:
- `src/invoices/invoices.service.ts` (cron แจ้งวันนัด, notify staff ตอน verify, push ประกัน)
- `src/payments/payments.service.ts` (push ผู้เช่า + notify staff ตอน verify/reject)
- `src/maintenance/maintenance.service.ts` (notify staff + แจ้งผู้เช่าเมื่อซ่อมเสร็จ)
- `src/line/line.service.ts` (timeout messages, link accept/reject, notifyMoveoutForDate ฯลฯ)
