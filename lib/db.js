import { Pool } from "pg";

const config = {
  connectionString: process.env.DATABASE_URL, 
  ssl: { 
    rejectUnauthorized: false 
  },
  connectionTimeoutMillis: 30000, // Tăng lên 30s
  idleTimeoutMillis: 30000,
  max: 20, // Tăng số lượng kết nối tối đa
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
