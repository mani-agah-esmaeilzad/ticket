import { ensureSchema } from "../lib/db";

async function main() {
  try {
    await ensureSchema();
    console.log("✅ Database schema initialized.");
  } catch (error) {
    console.error("❌ Failed to initialize schema:", error);
    process.exit(1);
  }
}

void main();
