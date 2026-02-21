import { Injectable, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as cron from 'node-cron';
import { exec } from 'child_process';

type ScheduleConfig = {
  hour: number;
  minute?: number;
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
      exec(cmd, (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, error: stderr || String(err) });
        } else {
          resolve({ ok: true, file });
        }
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
