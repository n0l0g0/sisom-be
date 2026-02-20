import * as fs from 'fs';
import * as path from 'path';

type ActivityPayload = {
  userId?: string;
  username?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  path?: string;
  details?: any;
};

const ensureUploadsDir = () => {
  const uploadsDir = path.resolve('/app/uploads');
  if (!fs.existsSync(uploadsDir)) {
    try {
      fs.mkdirSync(uploadsDir, { recursive: true });
    } catch {}
  }
  return uploadsDir;
};

const getLogsFilePath = () => {
  const dir = ensureUploadsDir();
  return path.join(dir, 'activity-logs.jsonl');
};

const getDeletedStorePath = () => {
  const dir = ensureUploadsDir();
  return path.join(dir, 'soft-deleted.json');
};

export const appendLog = (payload: ActivityPayload) => {
  try {
    const file = getLogsFilePath();
    const entry = {
      ...payload,
      timestamp: new Date().toISOString(),
    };
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch {}
};

export const readLogs = (limit = 500): any[] => {
  try {
    const file = getLogsFilePath();
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    const recent = lines.slice(Math.max(0, lines.length - limit));
    return recent
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

export type DeletedStore = Record<string, { ids: string[] }>;

export const readDeletedStore = (): DeletedStore => {
  try {
    const file = getDeletedStorePath();
    if (!fs.existsSync(file)) return {};
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as DeletedStore;
  } catch {
    return {};
  }
};

export const writeDeletedStore = (store: DeletedStore) => {
  try {
    const file = getDeletedStorePath();
    fs.writeFileSync(file, JSON.stringify(store, null, 2), 'utf8');
  } catch {}
};

export const softDeleteRecord = (model: string, id: string, snapshot?: any) => {
  const store = readDeletedStore();
  const set = new Set<string>(store[model]?.ids || []);
  set.add(id);
  store[model] = { ids: Array.from(set) };
  writeDeletedStore(store);
  appendLog({
    action: 'DELETE',
    entityType: model,
    entityId: id,
    details: { snapshot },
  });
};
