import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { Request } from 'express';

@Injectable()
export class MediaService {
  private readonly uploadDir: string;
  private readonly roomDir: string;

  constructor() {
    this.uploadDir = join(process.cwd(), 'uploads');
    if (!existsSync(this.uploadDir)) {
      mkdirSync(this.uploadDir, { recursive: true });
    }
    this.roomDir = '/root/room';
    if (!existsSync(this.roomDir)) {
      mkdirSync(this.roomDir, { recursive: true });
    }
  }

  getUploadDir() {
    return this.uploadDir;
  }

  getRoomDir() {
    return this.roomDir;
  }

  buildUrl(req: Request, filename: string) {
    const proto = req.get('x-forwarded-proto') || req.protocol;
    const host = req.get('host') || '';
    return `${proto}://${host}/api/media/${filename}`;
  }

  buildUrlFromBase(baseUrl: string, filename: string) {
    const trimmed = baseUrl.trim().replace(/^['"`]+|['"`]+$/g, '');
    const normalized = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
    return `${normalized}/api/media/${filename}`;
  }

  buildRoomUrlFromBase(baseUrl: string, filename: string) {
    const trimmed = baseUrl.trim().replace(/^['"`]+|['"`]+$/g, '');
    const normalized = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
    return `${normalized}/api/media/room/${filename}`;
  }
}
