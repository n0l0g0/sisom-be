
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

const filePath = '/root/uploads/room-contacts.json';
const roomId = 'cmlkgyrh100hble1crhmo7q32';
const contact = {
  id: randomUUID(),
  name: 'นางสาว วรากรณ์ โพนเวาะ',
  phone: '0844797940',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

try {
  let data: Record<string, any[]> = {};
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (raw.trim()) {
      data = JSON.parse(raw);
    }
  }

  if (!data[roomId]) {
    data[roomId] = [];
  }

  // Check if already exists
  const exists = data[roomId].find(c => c.phone === contact.phone);
  if (!exists) {
    data[roomId].push(contact);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log('Added contact to room-contacts.json');
  } else {
    console.log('Contact already exists in room-contacts.json');
  }

} catch (error) {
  console.error('Error updating room-contacts.json:', error);
}
