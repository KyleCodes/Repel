import { defineConfig, env } from 'prisma/config';

// Prisma CLI config. v7 does not auto-load .env files — the repel CLI (the
// only invoker) injects DATABASE_URL / SHADOW_DATABASE_URL into the child
// process env before shelling out, so nothing is loaded here.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
    // env() throws on unset vars; only `migrate dev` needs the shadow DB, so
    // it is declared only when the caller provides it.
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: env('SHADOW_DATABASE_URL') }
      : {}),
  },
});
