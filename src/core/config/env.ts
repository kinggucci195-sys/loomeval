import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().refine(
    (val) => val.startsWith('postgresql://') || val.startsWith('postgres://') || val.startsWith('file:'),
    {
      message: 'DATABASE_URL must start with postgresql://, postgres://, or file:',
    }
  ),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  REDIS_URL: z.string()
    .optional()
    .refine(
      (val) => !val || val.startsWith('redis://') || val.startsWith('rediss://'),
      {
        message: 'REDIS_URL must start with redis:// or rediss://',
      }
    ),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  throw new Error('Invalid environment variables: ' + JSON.stringify(parsed.error.format()));
}

export const env = parsed.data;
