// Ports for the GitHub summoner. Adapters implement these; package logic never touches globals.

export interface FetchRequest {
  /** Absolute https URL, host already allow-listed by the client. */
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  /** JSON string for POST. */
  readonly body?: string;
  /** Adapter enforces (AbortSignal.timeout). */
  readonly timeoutMs: number;
  /** Adapters MUST NOT follow redirects. */
  readonly redirect: "manual";
  /** Caller-initiated cancel (sibling failed). */
  readonly signal?: AbortSignal;
}

export interface FetchResponse {
  readonly status: number;
  /** Lower-cased names. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: ReadableStream<Uint8Array> | null;
}

export type FetchPort = (req: FetchRequest) => Promise<FetchResponse>;

/** Thrown by FetchPort adapters for transport-level failure; never a NecroError. */
export class FetchTransportError extends Error {
  readonly kind: "timeout" | "network";

  constructor(kind: "timeout" | "network", message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "FetchTransportError";
    this.kind = kind;
  }
}

export interface ClockPort {
  /** Epoch milliseconds. */
  nowMs(): number;
}

export interface EnvPort {
  get(key: "GITHUB_TOKEN"): string | undefined;
}

export interface SummonerDeps {
  readonly fetch: FetchPort;
  readonly clock: ClockPort;
  readonly env: EnvPort;
}
