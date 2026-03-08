import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { Request } from 'express';

/** Base upload directory (uploads/ or /app/uploads in Docker). */
const UPLOAD_BASE =
  process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');

@Injectable()
export class MediaService {
  private readonly uploadDir: string;
  private readonly roomDir: string;

  constructor() {
    this.uploadDir = UPLOAD_BASE;
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

  /** Directory for a tenant's uploads: uploads/{tenantId}/ */
  getUploadDirForTenant(tenantId: string): string {
    const dir = join(this.uploadDir, tenantId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  getRoomDir() {
    return this.roomDir;
  }

  /**
   * Build public URL for a file.
   * @param filename - Either "filename.ext" (legacy) or "tenantId/filename.ext"
   */
  buildUrl(req: Request, filename: string, tenantId?: string) {
    const proto = req.get('x-forwarded-proto') || req.protocol;
    const host = req.get('host') || '';
    const pathSegment = tenantId ? `${tenantId}/${filename}` : filename;
    return `${proto}://${host}/api/media/${pathSegment}`;
  }

  buildUrlFromBase(baseUrl: string, filename: string, tenantId?: string) {
    const trimmed = baseUrl.trim().replace(/^['"`]+|['"`]+$/g, '');
    const normalized = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
    const pathSegment = tenantId ? `${tenantId}/${filename}` : filename;
    return `${normalized}/api/media/${pathSegment}`;
  }

  buildRoomUrlFromBase(baseUrl: string, filename: string) {
    const trimmed = baseUrl.trim().replace(/^['"`]+|['"`]+$/g, '');
    const normalized = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
    return `${normalized}/api/media/room/${filename}`;
  }
}
