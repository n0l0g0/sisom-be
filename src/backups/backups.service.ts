import { Injectable, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as cron from 'node-cron';
import { exec } from 'child_process';
import { google } from 'googleapis';

type ScheduleConfig = {
  hour: number;
  minute?: number;
};

type OAuth2Config = {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  accessToken?: string;
  expiryDate?: number;
};

type GoogleDriveConfig = {
  folderId: string;
  autoUpload: boolean;
  credentials?: object;
  oauth2?: OAuth2Config;
};

@Injectable()
export class BackupsService implements OnModuleInit {
  private task: cron.ScheduledTask | null = null;

  onModuleInit() {
    const cfg = this.getSchedule();
    this.applySchedule(cfg);
  }

  private backupsDir() {
    const p = path.resolve('/app/uploads/backups');
    if (!fs.existsSync(p)) {
      try {
        fs.mkdirSync(p, { recursive: true });
      } catch {}
    }
    return p;
  }

  private configPath() {
    const dir = this.backupsDir();
    return path.join(dir, 'config.json');
  }

  private driveConfigPath() {
    return path.join(this.backupsDir(), 'gdrive.json');
  }

  getGoogleDriveConfig(): { folderId: string; autoUpload: boolean; connected: boolean; authType: string } {
    try {
      const raw = fs.readFileSync(this.driveConfigPath(), 'utf8');
      const cfg = JSON.parse(raw) as GoogleDriveConfig;
      const hasServiceAccount = !!(cfg.credentials && cfg.folderId);
      const hasOAuth2 = !!(cfg.oauth2?.clientId && cfg.oauth2?.refreshToken && cfg.folderId);
      return {
        folderId: cfg.folderId || '',
        autoUpload: cfg.autoUpload ?? false,
        connected: hasServiceAccount || hasOAuth2,
        authType: cfg.oauth2 ? 'oauth2' : (cfg.credentials ? 'service_account' : 'none'),
      };
    } catch {
      return { folderId: '', autoUpload: false, connected: false, authType: 'none' };
    }
  }

  setGoogleDriveConfig(data: {
    folderId: string;
    autoUpload: boolean;
    credentials?: object | null;
  }) {
    let existing: GoogleDriveConfig = { folderId: '', autoUpload: false };
    try {
      existing = JSON.parse(fs.readFileSync(this.driveConfigPath(), 'utf8'));
    } catch {}
    const next: GoogleDriveConfig = {
      folderId: data.folderId ?? existing.folderId,
      autoUpload: data.autoUpload ?? existing.autoUpload,
      credentials:
        data.credentials !== undefined ? data.credentials ?? undefined : existing.credentials,
    };
    fs.writeFileSync(this.driveConfigPath(), JSON.stringify(next, null, 2), 'utf8');
    return this.getGoogleDriveConfig();
  }

  removeGoogleDriveConfig() {
    try {
      fs.unlinkSync(this.driveConfigPath());
    } catch {}
    return { ok: true };
  }

  private appUrl() {
    return (process.env.API_URL || '').replace(/\/$/, '');
  }

  private oauthRedirectUri() {
    return `${this.appUrl()}/api/backups/google-drive/oauth/callback`;
  }

  initOAuth2(data: {
    clientId: string;
    clientSecret: string;
    folderId: string;
    autoUpload: boolean;
  }): string {
    const cfg: GoogleDriveConfig = {
      folderId: data.folderId,
      autoUpload: data.autoUpload,
      oauth2: { clientId: data.clientId, clientSecret: data.clientSecret },
    };
    fs.writeFileSync(this.driveConfigPath(), JSON.stringify(cfg, null, 2), 'utf8');
    const oauth2Client = new google.auth.OAuth2(
      data.clientId,
      data.clientSecret,
      this.oauthRedirectUri(),
    );
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/drive'],
      prompt: 'consent',
    });
  }

  async exchangeOAuth2Code(code: string): Promise<void> {
    const raw = fs.readFileSync(this.driveConfigPath(), 'utf8');
    const cfg = JSON.parse(raw) as GoogleDriveConfig;
    if (!cfg.oauth2?.clientId || !cfg.oauth2?.clientSecret) {
      throw new Error('OAuth2 credentials not configured');
    }
    const oauth2Client = new google.auth.OAuth2(
      cfg.oauth2.clientId,
      cfg.oauth2.clientSecret,
      this.oauthRedirectUri(),
    );
    const { tokens } = await oauth2Client.getToken(code);
    cfg.oauth2.refreshToken = tokens.refresh_token ?? cfg.oauth2.refreshToken;
    cfg.oauth2.accessToken = tokens.access_token ?? undefined;
    cfg.oauth2.expiryDate = tokens.expiry_date ?? undefined;
    fs.writeFileSync(this.driveConfigPath(), JSON.stringify(cfg, null, 2), 'utf8');
  }

  private async getDriveClient() {
    const raw = fs.readFileSync(this.driveConfigPath(), 'utf8');
    const cfg = JSON.parse(raw) as GoogleDriveConfig;

    if (cfg.oauth2?.clientId && cfg.oauth2?.clientSecret) {
      if (!cfg.oauth2.refreshToken) throw new Error('Not authorized yet — please connect Google Drive again');
      const oauth2Client = new google.auth.OAuth2(
        cfg.oauth2.clientId,
        cfg.oauth2.clientSecret,
      );
      oauth2Client.setCredentials({
        refresh_token: cfg.oauth2.refreshToken,
        access_token: cfg.oauth2.accessToken,
        expiry_date: cfg.oauth2.expiryDate,
      });
      oauth2Client.on('tokens', (tokens) => {
        try {
          const current = JSON.parse(fs.readFileSync(this.driveConfigPath(), 'utf8')) as GoogleDriveConfig;
          if (current.oauth2) {
            if (tokens.refresh_token) current.oauth2.refreshToken = tokens.refresh_token;
            if (tokens.access_token) current.oauth2.accessToken = tokens.access_token;
            if (tokens.expiry_date) current.oauth2.expiryDate = tokens.expiry_date;
            fs.writeFileSync(this.driveConfigPath(), JSON.stringify(current, null, 2));
          }
        } catch {}
      });
      return { drive: google.drive({ version: 'v3', auth: oauth2Client }), folderId: cfg.folderId };
    }

    if (cfg.credentials) {
      const auth = new google.auth.GoogleAuth({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        credentials: cfg.credentials as any,
        scopes: ['https://www.googleapis.com/auth/drive'],
      });
      return { drive: google.drive({ version: 'v3', auth }), folderId: cfg.folderId };
    }

    throw new Error('No Google Drive credentials configured');
  }

  async testGoogleDriveConnection(): Promise<{ ok: boolean; email?: string; error?: string }> {
    try {
      const { drive } = await this.getDriveClient();
      const about = await drive.about.get({ fields: 'user' });
      return { ok: true, email: about.data.user?.emailAddress ?? undefined };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async uploadToDrive(
    filename: string,
  ): Promise<{ ok: boolean; fileId?: string; webViewLink?: string; error?: string }> {
    try {
      const { drive, folderId } = await this.getDriveClient();
      const filePath = path.join(this.backupsDir(), path.basename(filename));
      if (!fs.existsSync(filePath)) return { ok: false, error: 'File not found' };
      const fileStream = fs.createReadStream(filePath);
      const res = await drive.files.create({
        supportsAllDrives: true,
        requestBody: {
          name: path.basename(filename),
          parents: folderId ? [folderId] : undefined,
        },
        media: { mimeType: 'application/octet-stream', body: fileStream },
        fields: 'id,webViewLink',
      });
      return {
        ok: true,
        fileId: res.data.id ?? undefined,
        webViewLink: res.data.webViewLink ?? undefined,
      };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  getSchedule(): ScheduleConfig {
    try {
      const raw = fs.readFileSync(this.configPath(), 'utf8');
      const parsed = JSON.parse(raw) as ScheduleConfig;
      const hour = Number(parsed.hour);
      const minute = Number(parsed.minute ?? 0);
      if (!Number.isFinite(hour) || hour < 0 || hour > 23)
        return { hour: 3, minute: 0 };
      if (!Number.isFinite(minute) || minute < 0 || minute > 59)
        return { hour, minute: 0 };
      return { hour, minute };
    } catch {
      return { hour: 3, minute: 0 };
    }
  }

  setSchedule(cfg: ScheduleConfig) {
    const hour = Math.max(0, Math.min(23, Number(cfg.hour)));
    const minute = Math.max(0, Math.min(59, Number(cfg.minute ?? 0)));
    const next: ScheduleConfig = { hour, minute };
    try {
      fs.writeFileSync(
        this.configPath(),
        JSON.stringify(next, null, 2),
        'utf8',
      );
    } catch {}
    this.applySchedule(next);
    return next;
  }

  private applySchedule(cfg: ScheduleConfig) {
    if (this.task) {
      try {
        this.task.stop();
      } catch {}
      this.task = null;
    }
    const cronExpr = `${cfg.minute ?? 0} ${cfg.hour} * * *`;
    this.task = cron.schedule(
      cronExpr,
      () => this.runBackup().catch(() => {}),
      {
        timezone: 'Asia/Bangkok',
      },
    );
  }

  async runBackup(): Promise<{ ok: boolean; file?: string; error?: string }> {
    const url = process.env.DATABASE_URL || '';
    let host = 'sisomapt-db';
    let port = '5432';
    let user = 'admin';
    let password = 'password';
    let db = 'sisomapt';
    try {
      if (url) {
        const u = new URL(url);
        host = u.hostname || host;
        port = String(u.port || port);
        user = u.username || user;
        password = u.password || password;
        db = (u.pathname || '/sisomapt').replace('/', '') || db;
      }
    } catch {}
    const timestamp = new Date();
    const mm = `${timestamp.getMonth() + 1}`.padStart(2, '0');
    const dd = `${timestamp.getDate()}`.padStart(2, '0');
    const HH = `${timestamp.getHours()}`.padStart(2, '0');
    const MM = `${timestamp.getMinutes()}`.padStart(2, '0');
    const file = path.join(
      this.backupsDir(),
      `db_${timestamp.getFullYear()}${mm}${dd}_${HH}${MM}.sql`,
    );
    const cmd = `PGPASSWORD='${password}' pg_dump -h ${host} -p ${port} -U ${user} -F p -f ${file} ${db}`;
    return new Promise((resolve) => {
      exec(cmd, async (err, _stdout, stderr) => {
        if (err) {
          resolve({ ok: false, error: stderr || String(err) });
          return;
        }
        const cfg = this.getGoogleDriveConfig();
        if (cfg.autoUpload && cfg.connected) {
          await this.uploadToDrive(path.basename(file)).catch(() => {});
        }
        resolve({ ok: true, file });
      });
    });
  }

  listFiles(): Array<{ name: string; size: number; mtime: string }> {
    const dir = this.backupsDir();
    try {
      const names = fs.readdirSync(dir).filter((n) => n.endsWith('.sql'));
      return names
        .map((name) => {
          const stat = fs.statSync(path.join(dir, name));
          return { name, size: stat.size, mtime: stat.mtime.toISOString() };
        })
        .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
    } catch {
      return [];
    }
  }

  deleteFile(name: string) {
    const p = path.join(this.backupsDir(), path.basename(name));
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {}
    return { ok: true };
  }
}
