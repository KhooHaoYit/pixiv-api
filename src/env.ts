import 'dotenv/config';

import { createEnv } from "@t3-oss/env-core";
import { z } from 'zod';

export const env = createEnv({
  server: {
    DATABASE_URL: z.string(),
    DISCORD_WEBHOOK_URL: z.string(),
    PORT: z.coerce.number().default(3000),
    HOSTNAME: z.string().default('0.0.0.0'),
    // Sentry
    SENTRY_DSN: z.string().optional(),
    SENTRY_ENVIRONMENT: z.enum(['local', 'production']).default('local'),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
    SENTRY_PROFILES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
  },
  client: {},
  runtimeEnv: process.env,
  clientPrefix: '',
});
