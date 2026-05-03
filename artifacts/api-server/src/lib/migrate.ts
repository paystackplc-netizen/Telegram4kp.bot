import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Ensure the database schema exists. Runs on startup so the production
 * deployment never crashes with "relation does not exist" even if
 * drizzle-kit push was never run against the production DB.
 */
export async function migrateDb(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        telegram_user_id BIGINT PRIMARY KEY,
        voice_id         TEXT    NOT NULL DEFAULT 'default',
        voice_name       TEXT,
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    logger.info("DB migration OK (user_preferences table ensured)");
  } catch (err) {
    logger.error({ err }, "DB migration failed — voice preferences will not persist");
    // Non-fatal: bot still works, just can't save voice picks
  }
}
