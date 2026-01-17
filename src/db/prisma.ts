import { PrismaClient } from '../../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

// Load .env files
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const backendEnv = join(__dirname, '../../.env');
const rootEnv = join(__dirname, '../../../.env');
const cwdEnv = join(process.cwd(), '.env');

if (existsSync(backendEnv)) {
  dotenv.config({ path: backendEnv, override: false });
}
if (existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv, override: false });
}
if (existsSync(cwdEnv)) {
  dotenv.config({ path: cwdEnv, override: false });
}

// Get DATABASE_URL
const databaseUrl = process.env.DATABASE_URL || 'postgresql://lastgame:admin@localhost:5433/lastgame';

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: databaseUrl,
});

// Create Prisma adapter factory
const adapterFactory = new PrismaPg(pool);

// Prisma Client singleton
// Prevents multiple instances in development with hot reload
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Prisma 7.x requires adapter or accelerateUrl
// PrismaPg is a factory, we pass it directly to PrismaClient
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: adapterFactory,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
  await pool.end();
});
