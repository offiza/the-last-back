// Test database connection
import dotenv from "dotenv";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env files
const backendEnv = join(__dirname, ".env");
const rootEnv = join(__dirname, "../.env");
const cwdEnv = join(process.cwd(), ".env");

console.log("🔍 Checking .env files...\n");

if (existsSync(backendEnv)) {
  console.log(`✅ Found: ${backendEnv}`);
  dotenv.config({ path: backendEnv });
} else {
  console.log(`❌ Not found: ${backendEnv}`);
}

if (existsSync(rootEnv)) {
  console.log(`✅ Found: ${rootEnv}`);
  dotenv.config({ path: rootEnv });
} else {
  console.log(`❌ Not found: ${rootEnv}`);
}

if (existsSync(cwdEnv)) {
  console.log(`✅ Found: ${cwdEnv}`);
  dotenv.config({ path: cwdEnv });
} else {
  console.log(`❌ Not found: ${cwdEnv}`);
}

console.log("\n📋 DATABASE_URL:");
const dbUrl = process.env.DATABASE_URL;
if (dbUrl) {
  const masked = dbUrl.replace(/:[^:@]+@/, ":****@");
  console.log(`   ${masked}\n`);
  
  // Try to parse URL
  try {
    const url = new URL(dbUrl);
    console.log("📊 Parsed URL:");
    console.log(`   Protocol: ${url.protocol}`);
    console.log(`   Host: ${url.hostname}`);
    console.log(`   Port: ${url.port || "default"}`);
    console.log(`   Database: ${url.pathname.slice(1)}`);
    console.log(`   User: ${url.username}`);
    if (url.search) {
      console.log(`   Query params: ${url.search}`);
    }
  } catch (e) {
    console.log(`   ⚠️ Could not parse URL: ${e.message}`);
  }
} else {
  console.log("   ❌ NOT SET!\n");
  console.log("💡 Add to backend/.env:");
  console.log("   DATABASE_URL=postgresql://lastgame:admin@localhost:5433/lastgame\n");
  process.exit(1);
}

