import { db, userPreferencesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function getUserVoice(telegramUserId: number): Promise<string> {
  const rows = await db
    .select()
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.telegramUserId, telegramUserId))
    .limit(1);
  return rows[0]?.voiceId ?? "default";
}

export async function setUserVoice(
  telegramUserId: number,
  voiceId: string,
): Promise<void> {
  await db
    .insert(userPreferencesTable)
    .values({ telegramUserId, voiceId })
    .onConflictDoUpdate({
      target: userPreferencesTable.telegramUserId,
      set: { voiceId, updatedAt: new Date() },
    });
}
