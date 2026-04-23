import { pgTable, bigint, text, timestamp } from "drizzle-orm/pg-core";

export const userPreferencesTable = pgTable("user_preferences", {
  telegramUserId: bigint("telegram_user_id", { mode: "number" }).primaryKey(),
  voiceId: text("voice_id").notNull().default("default"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type UserPreference = typeof userPreferencesTable.$inferSelect;
export type InsertUserPreference = typeof userPreferencesTable.$inferInsert;
