import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { SettingsService } from '../settings/settings.service';

type SlipOkResult = {
  ok: boolean;
  bankRef?: string;
  raw?: unknown;
  message?: string;
  amount?: number;
  sourceName?: string;
  sourceBank?: string;
  sourceAccount?: string;
  destName?: string;
  destBank?: string;
  destAccount?: string;
  transactedAt?: string;
  duplicate?: boolean;
  checkedAt?: string;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

const pickString = (
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined => {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string') {
      const s = v.trim();
      if (s) return s;
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      return String(v);
    }
  }
  return undefined;
};

const pickNumber = (
  obj: Record<string, unknown>,
  keys: string[],
): number | undefined => {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      return v;
    }
    if (typeof v === 'string') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
};

const pickNestedString = (
  obj: Record<string, unknown>,
  path: string[],
): string | undefined => {
  let current: unknown = obj;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  if (typeof current === 'string' && current.trim()) return current.trim();
  if (typeof current === 'number' && Number.isFinite(current)) {
    return String(current);
  }
  return undefined;
};

const pickPartyName = (
  detail: Record<string, unknown>,
  partyKey: 'sender' | 'receiver',
): string | undefined => {
  const party = isRecord(detail[partyKey]) ? detail[partyKey] : {};
  const direct = pickString(party, ['displayName', 'fullName']);
  if (direct) return direct;
  const name = isRecord(party.name) ? party.name : {};
  return pickString(name, ['displayName', 'fullName', 'th', 'en', 'value']);
};

const parseSlipOkResult = (
  dataUnknown: unknown,
  responseOk: boolean,
): SlipOkResult => {
  const root = isRecord(dataUnknown) ? dataUnknown : {};
  const detail = isRecord(root.data) ? root.data : root;
  const text =
    pickString(root, ['message', 'statusText']) ||
    pickString(detail, ['message', 'statusText']) ||
    (responseOk ? 'OK' : 'ERROR');
  const code = pickNumber(root, ['code']) ?? pickNumber(detail, ['code']);
  const successFlag = root.success === true || detail.success === true;
  const ok =
    responseOk &&
    code !== 1012 &&
    (successFlag ||
      code === 200 ||
      /Correct QR Verification|Valid Amount|OK|success|valid|✅/i.test(text));
  const duplicate = code === 1012;
  const bankRef =
    pickString(detail, ['bankRef', 'transRef', 'reference', 'ref']) ||
    pickString(root, ['bankRef', 'transRef', 'reference', 'ref']);
  const amount = pickNumber(detail, [
    'amount',
    'paidAmount',
    'total',
    'value',
    'price',
  ]);
  const sourceName = pickPartyName(detail, 'sender');
  const sourceBank = pickString(detail, [
    'sourceBank',
    'sendingBank',
    'senderBank',
    'fromBank',
    'originBank',
    'payerBank',
    'srcBank',
    'bank_from',
  ]);
  const sourceAccount =
    pickString(detail, [
      'sourceAccount',
      'senderAccount',
      'fromAccount',
      'originAccount',
      'payerAccount',
      'srcAccount',
      'accountFrom',
    ]) || pickNestedString(detail, ['sender', 'account', 'value']);
  const destBank = pickString(detail, [
    'destinationBank',
    'receivingBank',
    'receiverBank',
    'toBank',
    'bank',
    'bankName',
    'bank_code',
  ]);
  const destName = pickPartyName(detail, 'receiver');
  const destAccount =
    pickString(detail, [
      'destinationAccount',
      'receiverAccount',
      'toAccount',
      'accountNo',
      'account',
    ]) || pickNestedString(detail, ['receiver', 'account', 'value']);
  const date = pickString(detail, ['date', 'transDate']);
  const time = pickString(detail, ['time', 'transTime']);
  const transactedAt =
    pickString(detail, [
      'transactedAt',
      'transTimestamp',
      'datetime',
      'timestamp',
    ]) || (date && time ? `${date} ${time}` : undefined);
  const checkedAtRaw = duplicate
    ? text.match(/(?:เมื่อ|when)\s+(.+)$/i)?.[1]?.trim()
    : undefined;
  const checkedAtDate = checkedAtRaw ? new Date(checkedAtRaw) : undefined;
  const checkedAt =
    checkedAtDate && !Number.isNaN(checkedAtDate.getTime())
      ? checkedAtDate.toISOString()
      : checkedAtRaw;

  return {
    ok,
    bankRef,
    raw: root,
    message: text,
    amount,
    sourceName,
    sourceBank,
    sourceAccount,
    destName,
    destBank,
    destAccount,
    transactedAt,
    duplicate,
    checkedAt,
  };
};

@Injectable()
export class SlipOkService {
  constructor(private readonly settingsService: SettingsService) {}
  private readonly logger = new Logger(SlipOkService.name);

  async verifyByUrl(url: string, amount?: number): Promise<SlipOkResult> {
    const extra = await this.settingsService.getDormExtra();
    const apiKey = extra.slipokApiKey || process.env.SLIPOK_API_KEY;
    if (!apiKey) {
      this.logger.warn('SLIPOK_API_KEY is not set');
      return { ok: false, message: 'missing api key' };
    }
    try {
      const payload: Record<string, unknown> = { url };
      if (typeof amount === 'number') {
        payload.amount = amount;
      }
      const checkUrl =
        extra.slipokApiUrl ||
        process.env.SLIPOK_CHECK_URL ||
        'https://api.slipok.com/api/line/apikey/60698';
      const res = await fetch(checkUrl, {
        method: 'POST',
        headers: {
          'x-authorization': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...payload, log: false }),
      });
      const dataUnknown: unknown = await res.json().catch(() => ({}));
      const result = parseSlipOkResult(dataUnknown, res.ok);
      if (!result.ok) {
        this.logger.warn(`SlipOK verification failed: ${result.message}`);
      }
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`SlipOK request error: ${msg}`);
      return { ok: false, message: msg };
    }
  }

  async verifyByData(filePath: string, amount?: number): Promise<SlipOkResult> {
    const extra = await this.settingsService.getDormExtra();
    const apiKey = extra.slipokApiKey || process.env.SLIPOK_API_KEY;
    if (!apiKey) {
      this.logger.warn('SLIPOK_API_KEY is not set');
      return { ok: false, message: 'missing api key' };
    }
    try {
      const buf = await readFile(filePath);
      const blob = new Blob([buf], { type: 'image/jpeg' });
      const fd = new FormData();
      fd.append('files', blob, 'slip.jpg');
      fd.append('log', 'false');
      if (typeof amount === 'number') {
        fd.append('amount', String(amount));
      }
      const checkUrl =
        extra.slipokApiUrl ||
        process.env.SLIPOK_CHECK_URL ||
        'https://api.slipok.com/api/line/apikey/60698';
      const res = await fetch(checkUrl, {
        method: 'POST',
        headers: {
          'x-authorization': apiKey,
        },
        body: fd,
      });
      const dataUnknown: unknown = await res.json().catch(() => ({}));
      const result = parseSlipOkResult(dataUnknown, res.ok);
      if (!result.ok) {
        this.logger.warn(`SlipOK verification failed: ${result.message}`);
      }
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`SlipOK data request error: ${msg}`);
      return { ok: false, message: msg };
    }
  }
}
