import { db, userPreferencesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface UserVoice {
  uuid: string;
  name: string | null;
}

export async function getUserVoice(
  telegramUserId: number,
): Promise<UserVoice | null> {
  const rows = await db
    .select()
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.telegramUserId, telegramUserId))
    .limit(1);
  const row = rows[0];
  if (!row || !row.voiceId || row.voiceId === "default") return null;
  return { uuid: row.voiceId, name: row.voiceName ?? null };
}

export async function setUserVoice(
  telegramUserId: number,
  uuid: string,
  name: string,
): Promise<void> {
  await db
    .insert(userPreferencesTable)
    .values({ telegramUserId, voiceId: uuid, voiceName: name })
    .onConflictDoUpdate({
      target: userPreferencesTable.telegramUserId,
      set: { voiceId: uuid, voiceName: name, updatedAt: new Date() },
    });
}
