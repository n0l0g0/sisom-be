import { AsyncLocalStorage } from 'async_hooks';

export interface TenantContextStore {
  tenantId?: string;
}

export const tenantContext = new AsyncLocalStorage<TenantContextStore>();
