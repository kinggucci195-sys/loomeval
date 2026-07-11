import { AsyncLocalStorage } from 'async_hooks';

export interface TenantContext {
  projectId: string;
  workspaceId: string;
}

export const tenantLocalStorage = new AsyncLocalStorage<TenantContext>();

export const TenantManager = {
  run<T>(context: TenantContext, fn: () => Promise<T> | T): Promise<T> | T {
    return tenantLocalStorage.run(context, fn);
  },

  getContext(): TenantContext | undefined {
    return tenantLocalStorage.getStore();
  },

  requireContext(): TenantContext {
    const context = tenantLocalStorage.getStore();
    if (!context || !context.projectId || !context.workspaceId) {
      throw new Error('Unauthorized: Tenant context check failed');
    }
    return context;
  }
};
