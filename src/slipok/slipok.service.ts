import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'fs/promises';

type SlipOkResult = {
  ok: boolean;
  bankRef?: string;
  raw?: unknown;
  message?: string;
  amount?: number;
  sourceBank?: string;
  sourceAccount?: string;
  destBank?: string;
  destAccount?: string;
  transactedAt?: string;
  duplicate?: boolean;
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

@Injectable()
export class SlipOkService {
  private readonly logger = new Logger(SlipOkService.name);
  private readonly apiKey = process.env.SLIPOK_API_KEY;
  private readonly checkUrl =
    process.env.SLIPOK_CHECK_URL ||
    'https://api.slipok.com/api/line/apikey/60698';

  async verifyByUrl(url: string, amount?: number): Promise<SlipOkResult> {
    if (!this.apiKey) {
      this.logger.warn('SLIPOK_API_KEY is not set');
      return { ok: false, message: 'missing api key' };
    }
    try {
      const payload: Record<string, unknown> = { url };
      if (typeof amount === 'number') {
        payload.amount = amount;
      }
      const res = await fetch(this.checkUrl, {
        method: 'POST',
        headers: {
          'x-authorization': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...payload, log: true }),
      });
      const dataUnknown: unknown = await res.json().catch(() => ({}));
      const data = isRecord(dataUnknown) ? dataUnknown : {};
      const text =
        pickString(data, ['message', 'statusText']) ||
        (res.ok ? 'OK' : 'ERROR');
      const ok =
        res.ok &&
        /Correct QR Verification|Valid Amount|OK|success|valid/i.test(
          String(text),
        );
      const duplicate = pickNumber(data, ['code']) === 1012;
      const bankRef = pickString(data, ['bankRef', 'reference', 'ref']);
      const amountRaw = pickNumber(data, [
        'amount',
        'paidAmount',
        'total',
        'value',
        'price',
      ]);
      const amountVal = amountRaw ? amountRaw : undefined;
      const sourceBank = pickString(data, [
        'sourceBank',
        'senderBank',
        'fromBank',
        'originBank',
        'payerBank',
        'srcBank',
        'bank_from',
      ]);
      const sourceAccount = pickString(data, [
        'sourceAccount',
        'senderAccount',
        'fromAccount',
        'originAccount',
        'payerAccount',
        'srcAccount',
        'accountFrom',
      ]);
      const destBank = pickString(data, [
        'destinationBank',
        'receiverBank',
        'toBank',
        'bank',
        'bankName',
        'bank_code',
      ]);
      const destAccount = pickString(data, [
        'destinationAccount',
        'receiverAccount',
        'toAccount',
        'accountNo',
        'account',
      ]);
      const date = pickString(data, ['date']);
      const time = pickString(data, ['time']);
      const transactedAt =
        pickString(data, ['transactedAt', 'datetime', 'timestamp']) ||
        (date && time ? `${date} ${time}` : undefined);
      if (!ok) {
        this.logger.warn(`SlipOK verification failed: ${text}`);
      }
      return {
        ok,
        bankRef,
        raw: data,
        message: String(text),
        amount: amountVal,
        sourceBank,
        sourceAccount,
        destBank,
        destAccount,
        transactedAt,
        duplicate,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`SlipOK request error: ${msg}`);
      return { ok: false, message: msg };
    }
  }

  async verifyByData(filePath: string, amount?: number): Promise<SlipOkResult> {
    if (!this.apiKey) {
      this.logger.warn('SLIPOK_API_KEY is not set');
      return { ok: false, message: 'missing api key' };
    }
    try {
      const buf = await readFile(filePath);
      const blob = new Blob([buf], { type: 'image/jpeg' });
      const fd = new FormData();
      fd.append('files', blob, 'slip.jpg');
      fd.append('log', 'true');
      if (typeof amount === 'number') {
        fd.append('amount', String(amount));
      }
      const res = await fetch(this.checkUrl, {
        method: 'POST',
        headers: {
          'x-authorization': this.apiKey,
        },
        body: fd,
      });
      const dataUnknown: unknown = await res.json().catch(() => ({}));
      const data = isRecord(dataUnknown) ? dataUnknown : {};
      const text =
        pickString(data, ['message', 'statusText']) ||
        (res.ok ? 'OK' : 'ERROR');
      const ok =
        res.ok &&
        /Correct QR Verification|Valid Amount|OK|success|valid/i.test(
          String(text),
        );
      const duplicate = pickNumber(data, ['code']) === 1012;
      const bankRef = pickString(data, ['bankRef', 'reference', 'ref']);
      const amountRaw = pickNumber(data, [
        'amount',
        'paidAmount',
        'total',
        'value',
        'price',
      ]);
      const amountVal = amountRaw ? amountRaw : undefined;
      const sourceBank = pickString(data, [
        'sourceBank',
        'senderBank',
        'fromBank',
        'originBank',
        'payerBank',
        'srcBank',
        'bank_from',
      ]);
      const sourceAccount = pickString(data, [
        'sourceAccount',
        'senderAccount',
        'fromAccount',
        'originAccount',
        'payerAccount',
        'srcAccount',
        'accountFrom',
      ]);
      const destBank = pickString(data, [
        'destinationBank',
        'receiverBank',
        'toBank',
        'bank',
        'bankName',
        'bank_code',
      ]);
      const destAccount = pickString(data, [
        'destinationAccount',
        'receiverAccount',
        'toAccount',
        'accountNo',
        'account',
      ]);
      const date = pickString(data, ['date']);
      const time = pickString(data, ['time']);
      const transactedAt =
        pickString(data, ['transactedAt', 'datetime', 'timestamp']) ||
        (date && time ? `${date} ${time}` : undefined);
      if (!ok) {
        this.logger.warn(`SlipOK verification failed: ${text}`);
      }
      return {
        ok,
        bankRef,
        raw: data,
        message: String(text),
        amount: amountVal,
        sourceBank,
        sourceAccount,
        destBank,
        destAccount,
        transactedAt,
        duplicate,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`SlipOK data request error: ${msg}`);
      return { ok: false, message: msg };
    }
  }
}
