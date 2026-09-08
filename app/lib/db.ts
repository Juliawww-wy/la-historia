import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL 未设置，请在 .env.local 中配置");
}

/** The one DB entry point for the whole project — raw parameterized SQL, no ORM. */
export const sql = neon(databaseUrl);
