/**
 * One-time schema setup. Run manually after DATABASE_URL is configured:
 *   npx tsx db/migrate.ts
 *
 * No migration framework — there are only two tables and this project stays
 * deliberately dependency-light. Re-running is safe (everything is
 * `IF NOT EXISTS`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL 未设置，请先在 .env.local 中配置");
  process.exit(1);
}

const sql = neon(databaseUrl);
const schema = readFileSync(path.join(__dirname, "schema.sql"), "utf8");

async function main() {
  // neon() only runs single statements per call — split on blank-line
  // boundaries between statements (schema.sql has no semicolons inside
  // string literals, so a simple split is fine here).
  const statements = schema
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    console.log(statement.split("\n")[0] + " ...");
    await sql.query(statement);
  }

  console.log("完成。");
}

main().catch((err) => {
  console.error("建表失败:", err);
  process.exit(1);
});
