import { createHash } from "node:crypto";

// What ElevenLabs and Deepgram themselves report (docs/voice-spend.md), read with the platform's own keys, for Admin →
// Spend to set beside the platform's ledger (lib/spend/charges.ts). Read only. Checked against both APIs on 2026-11-20.
//
// ElevenLabs (workspace analytics, elevenlabs.io/docs/api-reference/analytics/workspace):
//   - usage-by-product-over-time: credits, minutes, US$ billed and request counts per day, grouped by API key. Its
//     `hashed_xi_api_key` is sha256(hex(sha256(key))); each row also carries the key's name.
//   - requests: every API request, with its trace id (the x-trace-id header the platform stores per call), path,
//     method and response code. Its `hashed_xi_api_key` is sha256(key).
// Deepgram (Manage API, developers.deepgram.com/reference/manage):
//   - requests: every request of the project, with its request id, API key id, path (with its `tag`), response code
//     and exact US$ cost; keys: the project's keys and their comments; balances: what's left of the credit.
//   - auth/grant: a temporary token (free) whose `accessor` claim is the id of the key that asked for it: how the
//     platform knows which of the project's keys is its own.

const TIMEOUT_MS = 12_000;
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

/** One read per key every few minutes: the page and its exports share it. */
function cached<T>(key: string, read: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as Promise<T>;
  const value = read();
  cache.set(key, { at: Date.now(), value });
  // A failure isn't kept: the next view tries again.
  value.catch(() => cache.delete(key));
  return value;
}

/** A tabular answer (columns + rows) as objects. */
function table(data: { columns?: string[]; rows?: unknown[][] }): Record<string, unknown>[] {
  const columns = data.columns ?? [];
  return (data.rows ?? []).map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index]])));
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// --- ElevenLabs ---------------------------------------------------------------------------------------------------

export type ElevenUsageRow = { day: string; keyHash: string; keyName: string; model: string; product: string; credits: number; minutes: number; usd: number; requests: number };
export type ElevenRequest = { at: string; traceId: string; path: string; pathPattern: string; method: string; code: number };
export type ElevenReport =
  | { ok: true; usage: ElevenUsageRow[]; ownUsageHash: string; requests: ElevenRequest[]; requestsComplete: boolean }
  | { ok: false; error: string };

async function elevenPost(path: string, body: unknown): Promise<Record<string, unknown>[]> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  const response = await fetch(`https://api.elevenlabs.io${path}`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`ElevenLabs ${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}`);
  return table((await response.json()) as { columns?: string[]; rows?: unknown[][] });
}

/** The month's usage of the whole ElevenLabs workspace by key, and every request the platform's key made. */
export function elevenReport(startMs: number, endMs: number): Promise<ElevenReport> {
  return cached(`eleven:${startMs}:${endMs}`, async (): Promise<ElevenReport> => {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return { ok: false, error: "ELEVENLABS_API_KEY isn't set on the platform." };
    try {
      const ownUsageHash = sha256(sha256(key));
      const usageRows = await elevenPost("/v1/workspace/analytics/query/usage-by-product-over-time", {
        start_time: startMs,
        end_time: endMs,
        interval_seconds: 86_400,
        time_zone: "UTC",
        group_by: ["hashed_xi_api_key", "model", "product_type"],
      });
      const usage = usageRows
        .map((row) => ({
          day: String(row.timestamp ?? "").slice(0, 10),
          keyHash: String(row.hashed_xi_api_key ?? ""),
          // No key: usage in ElevenLabs' own app (the website, Studio). A key without a name: shown by its hash.
          keyName: row.hashed_xi_api_key ? String(row.api_key_name || `Unnamed key ${String(row.hashed_xi_api_key).slice(0, 8)}`) : "ElevenLabs website (no API key)",
          model: String(row.model ?? ""),
          product: String(row.product_type ?? ""),
          credits: Number(row.total_usage ?? 0),
          minutes: Number(row.total_minutes ?? 0),
          usd: Number(row.total_cost ?? 0),
          requests: Number(row.usage_count ?? 0),
        }))
        .filter((row) => row.credits || row.usd || row.requests);

      // Every request of the platform's own key, oldest first, a page at a time.
      const ownRequestHash = sha256(key);
      const requests: ElevenRequest[] = [];
      let from = startMs;
      let complete = false;
      for (let page = 0; page < 20; page++) {
        const rows = await elevenPost("/v1/workspace/analytics/requests", {
          start_time: from,
          end_time: endMs,
          limit: 500,
          sort: "asc",
          filters: [{ column: "hashed_xi_api_key", operation: "eq", values: [ownRequestHash] }],
        });
        for (const row of rows) {
          requests.push({
            at: String(row.timestamp ?? ""),
            traceId: String(row.trace_id ?? ""),
            path: String(row.path ?? ""),
            pathPattern: String(row.path_pattern ?? ""),
            method: String(row.method ?? ""),
            code: Number(row.response_code ?? 0),
          });
        }
        if (rows.length < 500) {
          complete = true;
          break;
        }
        from = Date.parse(requests.at(-1)!.at) + 1;
      }
      // Pages can meet at a shared timestamp: one row per trace id.
      const seen = new Set<string>();
      const unique = requests.filter((request) => (seen.has(request.traceId) ? false : (seen.add(request.traceId), true)));
      return { ok: true, usage, ownUsageHash, requests: unique, requestsComplete: complete };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

// --- Deepgram -----------------------------------------------------------------------------------------------------

/** Pages of Deepgram's request log read per report: 6,000 requests, within an Amplify request's time. */
const PAGES = 60;

export type DeepgramRequest = { id: string; at: string; keyId: string; path: string; tag: string | null; usd: number; code: number; method: string };
export type DeepgramReport =
  | { ok: true; ownKeyId: string | null; keys: { id: string; comment: string }[]; requests: DeepgramRequest[]; requestsComplete: boolean; balanceUsd: number | null }
  | { ok: false; error: string };

async function deepgramGet<T>(path: string): Promise<T> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY is not set");
  const response = await fetch(`https://api.deepgram.com${path}`, { headers: { Authorization: `Token ${key}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Deepgram ${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}`);
  return (await response.json()) as T;
}

/** The id of the platform's own Deepgram key: the `accessor` of a temporary token it asks for (free, 30 s). */
async function ownDeepgramKey(): Promise<string | null> {
  try {
    const response = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const token = ((await response.json()) as { access_token?: string }).access_token;
    const claims = token ? (JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { accessor?: string }) : null;
    return claims?.accessor ?? null;
  } catch {
    return null;
  }
}

/** The month's requests of the whole Deepgram project, its keys, and its balance. */
export function deepgramReport(startMs: number, endMs: number): Promise<DeepgramReport> {
  return cached(`deepgram:${startMs}:${endMs}`, async (): Promise<DeepgramReport> => {
    if (!process.env.DEEPGRAM_API_KEY) return { ok: false, error: "DEEPGRAM_API_KEY isn't set on the platform." };
    try {
      const { projects } = await deepgramGet<{ projects?: { project_id: string }[] }>("/v1/projects");
      const project = projects?.[0]?.project_id;
      if (!project) return { ok: false, error: "This Deepgram key sees no project." };
      const [keys, balances, ownKeyId] = await Promise.all([
        deepgramGet<{ api_keys?: { api_key: { api_key_id: string; comment?: string } }[] }>(`/v1/projects/${project}/keys`).catch(() => ({ api_keys: [] })),
        deepgramGet<{ balances?: { amount: number; units: string }[] }>(`/v1/projects/${project}/balances`).catch(() => ({ balances: [] })),
        ownDeepgramKey(),
      ]);
      const start = new Date(startMs).toISOString().slice(0, 19);
      const end = new Date(endMs).toISOString().slice(0, 19);
      const requests: DeepgramRequest[] = [];
      let complete = false;
      // 100 a page, Deepgram's most (its docs say 1,000; the API refuses more than 100, 2026-11-20).
      for (let page = 0; page < PAGES; page++) {
        const data = await deepgramGet<{
          requests?: {
            request_id: string;
            created: string;
            path: string;
            api_key_id: string;
            response?: { code?: number; details?: { usd?: number; tags?: string[]; method?: string } };
          }[];
        }>(`/v1/projects/${project}/requests?start=${start}&end=${end}&limit=100&page=${page}`);
        const rows = data.requests ?? [];
        for (const row of rows) {
          const tag = row.response?.details?.tags?.[0] ?? new URL(row.path, "https://api.deepgram.com").searchParams.get("tag");
          requests.push({
            id: row.request_id,
            at: row.created,
            keyId: row.api_key_id,
            path: row.path.split("?")[0],
            tag: tag || null,
            usd: Number(row.response?.details?.usd ?? 0),
            code: Number(row.response?.code ?? 0),
            method: row.response?.details?.method ?? "",
          });
        }
        if (rows.length < 100) {
          complete = true;
          break;
        }
      }
      const usd = (balances.balances ?? []).filter((balance) => balance.units === "usd").reduce((sum, balance) => sum + balance.amount, 0);
      return {
        ok: true,
        ownKeyId,
        keys: (keys.api_keys ?? []).map(({ api_key }) => ({ id: api_key.api_key_id, comment: api_key.comment ?? "" })),
        requests,
        requestsComplete: complete,
        balanceUsd: balances.balances?.length ? usd : null,
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
