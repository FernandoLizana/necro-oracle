import { FetchTransportError, type FetchPort, type FetchRequest, type FetchResponse } from "../ports.js";

export interface FixtureSpec {
  /** Default "GET". */
  readonly method?: "GET" | "POST";
  readonly url: string;
  /** Default 200 (302 when `redirectTo` is set). */
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
  /** Serialized as the body; sets no content-type. */
  readonly json?: unknown;
  /** Adds a lower-cased `location` header. */
  readonly redirectTo?: string;
  /** Makes the fetch throw FetchTransportError instead of responding. */
  readonly transportError?: "timeout" | "network";
  /** Lazily pulled chunks; cancellation is recorded on the handle. */
  readonly stream?: readonly Uint8Array[];
}

export interface FixtureHandle {
  cancelCalls: number;
  chunksPulled: number;
}

export interface FixtureFetch {
  readonly fetch: FetchPort;
  readonly requests: FetchRequest[];
  register(spec: FixtureSpec): FixtureHandle;
}

const encoder = new TextEncoder();

function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice());
      controller.close();
    },
  });
}

function chunkStream(chunks: readonly Uint8Array[], handle: FixtureHandle): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks[index];
        if (chunk === undefined) {
          controller.close();
          return;
        }
        index += 1;
        handle.chunksPulled += 1;
        controller.enqueue(chunk.slice());
      },
      cancel() {
        handle.cancelCalls += 1;
      },
    },
    { highWaterMark: 0 },
  );
}

function keyOf(method: string, url: string): string {
  return `${method} ${url}`;
}

/** A FetchPort answering from registered fixtures; records every request. */
export function createFixtureFetch(): FixtureFetch {
  const specs = new Map<string, { spec: FixtureSpec; handle: FixtureHandle }>();
  const requests: FetchRequest[] = [];

  const fetch: FetchPort = (req) => {
    requests.push(req);
    const found = specs.get(keyOf(req.method, req.url));
    if (found === undefined) {
      return Promise.reject(new Error(`fixture-fetch: unregistered request ${req.method} ${req.url}`));
    }
    const { spec, handle } = found;
    if (spec.transportError !== undefined) {
      return Promise.reject(
        new FetchTransportError(spec.transportError, `fixture-fetch: scripted ${spec.transportError} for ${req.url}`),
      );
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(spec.headers ?? {})) headers[k.toLowerCase()] = v;
    if (spec.redirectTo !== undefined) headers["location"] = spec.redirectTo;

    let body: ReadableStream<Uint8Array> | null = null;
    if (spec.stream !== undefined) body = chunkStream(spec.stream, handle);
    else if (spec.json !== undefined) body = bytesStream(encoder.encode(JSON.stringify(spec.json)));
    else if (spec.body !== undefined) {
      body = bytesStream(typeof spec.body === "string" ? encoder.encode(spec.body) : spec.body);
    }
    const response: FetchResponse = {
      status: spec.status ?? (spec.redirectTo !== undefined ? 302 : 200),
      headers,
      body,
    };
    return Promise.resolve(response);
  };

  return {
    fetch,
    requests,
    register(spec: FixtureSpec): FixtureHandle {
      const handle: FixtureHandle = { cancelCalls: 0, chunksPulled: 0 };
      specs.set(keyOf(spec.method ?? "GET", spec.url), { spec, handle });
      return handle;
    },
  };
}
