import '../core/config/env';
import { PrismaClient } from '@prisma/client';
import { TenantManager } from '../core/security/tenant';

const globalForPrisma = global as unknown as { prisma: any };

const rawPrisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ['error'],
  });

if (process.env.NODE_ENV !== 'production' && !globalForPrisma.prisma) {
  globalForPrisma.prisma = rawPrisma;
}

const ISOLATED_MODELS = ['trace', 'replayjob', 'replayresult', 'experiment', 'experimentrun'];

function getTenantFilter(modelLower: string, projectId: string) {
  switch (modelLower) {
    case 'trace':
      return { projectId };
    case 'replayresult':
      return { trace: { projectId } };
    case 'replayjob':
      return { results: { some: { trace: { projectId } } } };
    case 'experiment':
      return { testSuite: { projectId } };
    case 'experimentrun':
      return { experiment: { testSuite: { projectId } } };
    default:
      return null;
  }
}

// Helper to flatten compound keys for findFirst/findFirstOrThrow
function flattenCompoundKeys(where: any) {
  if (!where) return where;
  const targetWhere = { ...where };
  for (const [key, value] of Object.entries(targetWhere)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      if (key.includes('_')) {
        Object.assign(targetWhere, value);
        delete targetWhere[key];
      }
    }
  }
  return targetWhere;
}

export const prisma = rawPrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const modelLower = model.toLowerCase();
        
        // If this query is marked to bypass isolation, run it directly
        if ((args as any)?.__bypassIsolation) {
          const cleanArgs = { ...args };
          delete (cleanArgs as any).__bypassIsolation;
          return query(cleanArgs);
        }

        if (!ISOLATED_MODELS.includes(modelLower)) {
          return query(args);
        }

        const context = TenantManager.getContext();
        if (!context || !context.projectId) {
          return query(args);
        }

        const projectId = context.projectId;
        const tenantFilter = getTenantFilter(modelLower, projectId);

        if (!tenantFilter) {
          return query(args);
        }

        // Handle findUnique / findUniqueOrThrow by translating to findFirst / findFirstOrThrow
        let op = operation;
        const targetArgs = { ...args };

        if (op === 'findUnique' || op === 'findUniqueOrThrow') {
          op = op === 'findUnique' ? 'findFirst' : 'findFirstOrThrow';
          targetArgs.where = flattenCompoundKeys(targetArgs.where);
        }

        // For single record updates/deletes, pre-flight check project ownership
        if (op === 'update' || op === 'delete') {
          const modelProp = model.charAt(0).toLowerCase() + model.slice(1);
          const modelClient = (rawPrisma as any)[modelProp];
          
          if (modelClient) {
            const check = await modelClient.findFirst({
              where: {
                ...flattenCompoundKeys(args.where),
                ...tenantFilter,
              },
              select: { id: true },
            });
            
            if (!check) {
              throw new Error('Unauthorized: Tenant context check failed');
            }
          }
        }

        // For create operations, assert the resource belongs to the current tenant project if possible
        if (op === 'create') {
          if (modelLower === 'trace' && args.data?.projectId && args.data.projectId !== projectId) {
            throw new Error('Unauthorized: Tenant context check failed');
          }
        }

        // For read operations and multi-write operations, append filter to where
        if (op === 'findFirst' || op === 'findFirstOrThrow' || op === 'findMany' || op === 'count' || op === 'aggregate' || op === 'groupBy' || op === 'updateMany' || op === 'deleteMany') {
          targetArgs.where = {
            ...targetArgs.where,
            ...tenantFilter,
          };
        }

        // Execute query on extended client using bypassed execution to prevent recursion
        if (op !== operation) {
          const modelProp = model.charAt(0).toLowerCase() + model.slice(1);
          const extendedModelClient = (prisma as any)[modelProp];
          if (extendedModelClient && typeof extendedModelClient[op] === 'function') {
            const finalArgs = { ...targetArgs, __bypassIsolation: true };
            try {
              return await extendedModelClient[op](finalArgs);
            } catch (err: any) {
              if (err.code === 'P2025' || err.message?.includes('Record to update not found') || err.message?.includes('Record to delete not found')) {
                throw new Error('Unauthorized: Tenant context check failed');
              }
              throw err;
            }
          }
        }

        return query(targetArgs);
      }
    }
  }
}) as any;
