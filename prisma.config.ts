// Prisma configuration file
// In Prisma 7.x, DATABASE_URL must be specified here, not in schema.prisma
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { defineConfig } from "prisma/config";

// Load .env from backend directory or root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try to load .env files in order of priority
// 1. backend/.env (highest priority)
// 2. .env in root directory
const backendEnv = join(__dirname, "../.env");
const rootEnv = join(__dirname, "../../.env");

// Load .env files if they exist
if (existsSync(backendEnv)) {
  dotenv.config({ path: backendEnv, override: false });
}
if (existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv, override: false });
}

// Also try loading from process.cwd() (current working directory)
// This helps when running from different directories
const cwdEnv = join(process.cwd(), ".env");
if (existsSync(cwdEnv)) {
  dotenv.config({ path: cwdEnv, override: false });
}

// Get DATABASE_URL from environment
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn("⚠️ DATABASE_URL not found in environment variables");
  console.warn(`   Checked: ${backendEnv} (${existsSync(backendEnv) ? "exists" : "not found"})`);
  console.warn(`   Checked: ${rootEnv} (${existsSync(rootEnv) ? "exists" : "not found"})`);
  console.warn(`   Checked: ${cwdEnv} (${existsSync(cwdEnv) ? "exists" : "not found"})`);
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Используем DATABASE_URL из .env или fallback для локальной разработки
    url: databaseUrl || "postgresql://lastgame:admin@localhost:5433/lastgame",
  },
});
