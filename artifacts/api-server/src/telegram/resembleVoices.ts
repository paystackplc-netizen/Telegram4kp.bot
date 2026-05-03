import { logger } from "../lib/logger";

const VOICES_ENDPOINT =
  process.env["RESEMBLE_VOICES_ENDPOINT"] ||
  "https://app.resemble.ai/api/v2/voices";
const PAGE_SIZE = 10;
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface ResembleVoice {
  uuid: string;
  name: string;
  status?: string;
  gender?: string | null;
  language?: string | null;
}

interface VoicesPage {
  items: ResembleVoice[];
  page: number;
  numPages: number;
  pageSize: number;
}

interface CachedAll {
  fetchedAt: number;
  voices: ResembleVoice[];    // only ready voices
  allVoices: ResembleVoice[]; // every voice including non-ready
}

let cache: CachedAll | null = null;
let inflight: Promise<CachedAll> | null = null;

/** A voice is usable if its status is "ready" or unknown (older API versions omit status). */
function isReady(v: ResembleVoice): boolean {
  return !v.status || v.status === "ready";
}

async function fetchAllVoices(signal?: AbortSignal): Promise<CachedAll> {
  const apiKey = process.env["RESEMBLE_API_KEY"];
  if (!apiKey) throw new Error("RESEMBLE_API_KEY not configured");

  const all: ResembleVoice[] = [];
  let page = 1;
  let numPages = 1;
  do {
    const url = new URL(VOICES_ENDPOINT);
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", String(PAGE_SIZE));
    const res = await fetch(url, {
      headers: {
        Authorization: `Token ${apiKey}`,
        accept: "application/json",
      },
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error(
        { status: res.status, body: body.slice(0, 300) },
        "Resemble voices list failed",
      );
      throw new Error(`Resemble voices list failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      success?: boolean;
      items?: Array<Record<string, unknown>>;
      num_pages?: number;
    };
    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      const uuid = typeof item["uuid"] === "string" ? (item["uuid"] as string) : "";
      const name = typeof item["name"] === "string" ? (item["name"] as string) : "";
      if (!uuid || !name) continue;
      all.push({
        uuid,
        name,
        status: typeof item["status"] === "string" ? (item["status"] as string) : undefined,
        gender: typeof item["gender"] === "string" ? (item["gender"] as string) : null,
        language: typeof item["language"] === "string" ? (item["language"] as string) : null,
      });
    }
    numPages = typeof data.num_pages === "number" ? data.num_pages : 1;
    page += 1;
    if (page > 50) break;
  } while (page <= numPages);

  const ready = all.filter(isReady);
  const notReady = all.filter((v) => !isReady(v));
  if (notReady.length > 0) {
    logger.info(
      { notReady: notReady.map((v) => `${v.name} (${v.status ?? "unknown"})`).join(", ") },
      "Resemble: some voices are not ready and will be hidden from picker",
    );
  }

  const sort = (arr: ResembleVoice[]) =>
    arr.sort((a, b) => a.name.localeCompare(b.name));

  return { voices: sort(ready), allVoices: sort(all), fetchedAt: Date.now() };
}

async function getCache(forceRefresh = false, signal?: AbortSignal): Promise<CachedAll> {
  const now = Date.now();
  if (!forceRefresh && cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = fetchAllVoices(signal)
    .then((c) => { cache = c; return c; })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Only ready voices — used for the /voices picker. */
export async function getAllVoices(
  forceRefresh = false,
  signal?: AbortSignal,
): Promise<ResembleVoice[]> {
  const c = await getCache(forceRefresh, signal);
  return c.voices;
}

export async function getVoicesPage(
  page: number,
  signal?: AbortSignal,
): Promise<VoicesPage> {
  const voices = await getAllVoices(false, signal);
  const numPages = Math.max(1, Math.ceil(voices.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), numPages);
  const start = (safePage - 1) * PAGE_SIZE;
  return {
    items: voices.slice(start, start + PAGE_SIZE),
    page: safePage,
    numPages,
    pageSize: PAGE_SIZE,
  };
}

export async function findVoiceByUuid(uuid: string): Promise<ResembleVoice | null> {
  const c = await getCache().catch(() => null);
  const all = c?.allVoices ?? [];
  return all.find((v) => v.uuid === uuid) ?? null;
}

export async function findVoiceByQuery(query: string): Promise<ResembleVoice | null> {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  // Search only ready voices — can't use a non-ready one for synthesis
  const voices = await getAllVoices().catch(() => [] as ResembleVoice[]);
  const exactUuid = voices.find((v) => v.uuid.toLowerCase() === q);
  if (exactUuid) return exactUuid;
  const exactName = voices.find((v) => v.name.toLowerCase() === q);
  if (exactName) return exactName;
  const starts = voices.find((v) => v.name.toLowerCase().startsWith(q));
  if (starts) return starts;
  return voices.find((v) => v.name.toLowerCase().includes(q)) ?? null;
}

/**
 * Check whether a previously-saved voice UUID is still ready.
 * Returns the voice if OK, null if it no longer exists or isn't ready.
 */
export async function checkVoiceReady(uuid: string): Promise<ResembleVoice | null> {
  const c = await getCache().catch(() => null);
  const all = c?.allVoices ?? [];
  const voice = all.find((v) => v.uuid === uuid);
  if (!voice) return null;
  if (!isReady(voice)) return null;
  return voice;
}

export async function getDefaultVoice(): Promise<{ uuid: string; name: string } | null> {
  const envUuid = (process.env["RESEMBLE_VOICE_DEFAULT"] || "").trim();
  const voices = await getAllVoices().catch(() => [] as ResembleVoice[]);
  if (envUuid) {
    const match = voices.find((v) => v.uuid === envUuid);
    if (match) return { uuid: match.uuid, name: match.name };
    logger.warn(
      { envUuid },
      "RESEMBLE_VOICE_DEFAULT is not a ready voice in this account; using first available",
    );
  }
  if (voices.length > 0) {
    const first = voices[0]!;
    return { uuid: first.uuid, name: first.name };
  }
  return null;
}
