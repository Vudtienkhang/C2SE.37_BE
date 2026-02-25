
import { Pool } from "pg";

const config = {
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false },
  family: 4,
  connectionTimeoutMillis: 20000,
  idleTimeoutMillis: 30000,
};

export const db = new Pool(config);

export async function assertDb() {
  try {
    const { rows } = await db.query("SELECT NOW()");
    console.log("PG connected at", rows[0].now);
  } catch (e) {
    console.error("PG connect error:", e.message);
    throw e;
  }
}
