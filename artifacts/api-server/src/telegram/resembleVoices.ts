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
  voices: ResembleVoice[];
}

let cache: CachedAll | null = null;
let inflight: Promise<ResembleVoice[]> | null = null;

async function fetchAllVoices(signal?: AbortSignal): Promise<ResembleVoice[]> {
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
        gender:
          typeof item["gender"] === "string" ? (item["gender"] as string) : null,
        language:
          typeof item["language"] === "string"
            ? (item["language"] as string)
            : null,
      });
    }
    numPages = typeof data.num_pages === "number" ? data.num_pages : 1;
    page += 1;
    // Safety cap
    if (page > 50) break;
  } while (page <= numPages);

  // Sort: ready-status voices first, then alphabetical
  all.sort((a, b) => {
    const ar = a.status === "ready" ? 0 : 1;
    const br = b.status === "ready" ? 0 : 1;
    if (ar !== br) return ar - br;
    return a.name.localeCompare(b.name);
  });
  return all;
}

export async function getAllVoices(
  forceRefresh = false,
  signal?: AbortSignal,
): Promise<ResembleVoice[]> {
  const now = Date.now();
  if (!forceRefresh && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.voices;
  }
  if (inflight) return inflight;
  inflight = fetchAllVoices(signal)
    .then((voices) => {
      cache = { fetchedAt: Date.now(), voices };
      return voices;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
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

export async function findVoiceByUuid(
  uuid: string,
): Promise<ResembleVoice | null> {
  const all = await getAllVoices().catch(() => [] as ResembleVoice[]);
  return all.find((v) => v.uuid === uuid) ?? null;
}

export async function findVoiceByQuery(
  query: string,
): Promise<ResembleVoice | null> {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const all = await getAllVoices().catch(() => [] as ResembleVoice[]);
  // Exact uuid
  const exactUuid = all.find((v) => v.uuid.toLowerCase() === q);
  if (exactUuid) return exactUuid;
  // Exact name (case-insensitive)
  const exactName = all.find((v) => v.name.toLowerCase() === q);
  if (exactName) return exactName;
  // Starts-with
  const starts = all.find((v) => v.name.toLowerCase().startsWith(q));
  if (starts) return starts;
  // Contains
  const contains = all.find((v) => v.name.toLowerCase().includes(q));
  return contains ?? null;
}

export async function getDefaultVoice(): Promise<{ uuid: string; name: string } | null> {
  const envUuid = (process.env["RESEMBLE_VOICE_DEFAULT"] || "").trim();
  const all = await getAllVoices().catch(() => [] as ResembleVoice[]);
  if (envUuid) {
    const match = all.find((v) => v.uuid === envUuid);
    if (match) return { uuid: match.uuid, name: match.name };
    // env UUID not in account — fall through to first voice
    logger.warn(
      { envUuid },
      "RESEMBLE_VOICE_DEFAULT does not match any voice in this account; using first available",
    );
  }
  if (all.length > 0) {
    const first = all[0]!;
    return { uuid: first.uuid, name: first.name };
  }
  return null;
}
