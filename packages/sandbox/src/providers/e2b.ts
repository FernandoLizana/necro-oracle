// @necro/sandbox — optional E2B SandboxPort (parse-only / compile-only).
//
// This provider augments the default tree-sitter Target_Parser with a
// compile-only check (`python3 -m py_compile`) run inside an isolated E2B
// micro-VM. It is OPTIONAL: the default local path (requirements R5.7, R10.1)
// needs no E2B account and never constructs this provider. We guard
// construction behind config presence so importing this module costs nothing
// and the SDK is loaded only when an E2B key is actually configured.
//
// Security invariants (steering: security rules 1 & 3):
//   - Repository code is UNTRUSTED DATA. We only ever run the fixed, allowlisted
//     `py_compile` command (see allowlist.ts); `py_compile` byte-compiles the
//     source to check that it parses, importing and executing nothing in it.
//     Repository code is NEVER executed.
//   - The candidate source is written to a fixed sandbox path and read by the
//     command as a file; it is never interpolated into a shell line.
//   - One micro-VM per provider instance; it is destroyed (`dispose`) in every
//     terminal state — success, parse failure, timeout, or error (R10.4/R10.5).
//   - Resource and time limits are always set; output is irrelevant to the
//     result (we read only the exit status) and is never surfaced raw.

import { NecroError } from "@necro/oracle";
import type { SandboxPort } from "@necro/coven";
import {
  CANDIDATE_PATH,
  PY_COMPILE_ARGV,
  allowlistedArgv,
} from "../allowlist.js";

/** Config needed to open an E2B sandbox. Absent key => provider is not created. */
export interface E2bConfig {
  /** E2B API key (server-only). Blank/whitespace is treated as unset upstream. */
  readonly apiKey: string;
  /**
   * Template id with Python 3 available (e.g. `necro-py312`). Defaults to a
   * Python 3 template id; the template must contain `python3`.
   */
  readonly template?: string;
  /** Hard ceiling on micro-VM lifetime in ms, independent of per-call timeout. */
  readonly maxLifetimeMs?: number;
}

/**
 * Minimal structural view of the `e2b` TS SDK surface we use. We depend on it
 * via a dynamic import and this local type so the package typechecks and builds
 * with no E2B account and without the SDK installed on the default path.
 */
interface E2bSandboxLike {
  files: {
    write(path: string, data: string): Promise<unknown>;
  };
  commands: {
    run(
      cmd: string,
      opts?: { readonly timeoutMs?: number },
    ): Promise<{ readonly exitCode: number }>;
  };
  kill(): Promise<unknown>;
}

interface E2bModuleLike {
  Sandbox: {
    create(opts: {
      readonly apiKey: string;
      readonly template?: string;
      readonly timeoutMs?: number;
    }): Promise<E2bSandboxLike>;
  };
}

const DEFAULT_TEMPLATE = "necro-py312";
const DEFAULT_MAX_LIFETIME_MS = 60_000;

/**
 * Module specifier for the optional `e2b` TS SDK, resolved at runtime only.
 * Kept in a non-literal binding so the compiler does not require the SDK to be
 * installed on the default/local path (R5.7, R10.1). When E2B is configured the
 * real package resolves normally.
 */
const E2B_MODULE_ID: string = "e2b";

/**
 * True iff an E2B sandbox is configured. The composition root uses this to
 * decide whether to inject a `SandboxPort` at all; when false the engine uses
 * the Target_Parser only (R5.7) and no SDK is loaded.
 */
export function isE2bConfigured(
  cfg: { readonly apiKey?: string | undefined } | undefined | null,
): cfg is E2bConfig {
  return typeof cfg?.apiKey === "string" && cfg.apiKey.trim() !== "";
}

/**
 * Build an optional E2B {@link SandboxPort}, or `undefined` when E2B is not
 * configured. Returning `undefined` keeps the caller on the Target_Parser-only
 * path with zero E2B dependency.
 */
export function createE2bSandboxPort(
  cfg: { readonly apiKey?: string | undefined } | undefined | null,
): SandboxPort | undefined {
  if (!isE2bConfigured(cfg)) return undefined;
  return new E2bSandboxPort(cfg);
}

/**
 * Optional parse-only SandboxPort backed by an E2B micro-VM. Lazily opens a
 * single sandbox on first use and reuses it for the ritual; `dispose` destroys
 * it. Every `parseCheckPython3` invocation runs only the allowlisted
 * compile-only command and treats a non-zero exit as "does not parse".
 */
export class E2bSandboxPort implements SandboxPort {
  readonly #cfg: E2bConfig;
  #sandbox: E2bSandboxLike | null = null;
  #opening: Promise<E2bSandboxLike> | null = null;

  constructor(cfg: E2bConfig) {
    this.#cfg = cfg;
  }

  async parseCheckPython3(
    source: string,
    opts: { timeoutMs: number },
  ): Promise<{ readonly ok: boolean }> {
    // Only the fixed, allowlisted compile-only command may ever run here.
    const argv = allowlistedArgv("py_compile");
    if (argv !== PY_COMPILE_ARGV) {
      throw new NecroError(
        "VALIDATION_FAILED",
        "The circle rejects an unsanctioned rite. (sandbox command not on the allowlist)",
      );
    }

    try {
      const sandbox = await this.#ensureSandbox(opts.timeoutMs);
      // Deliver untrusted source as a FILE the command reads; never as code.
      await sandbox.files.write(CANDIDATE_PATH, source);
      // Join the frozen argv into a shell line from TRUSTED, fixed tokens only
      // (no repository content is interpolated).
      const result = await sandbox.commands.run(argv.join(" "), {
        timeoutMs: opts.timeoutMs,
      });
      return { ok: result.exitCode === 0 };
    } catch (cause) {
      // Any sandbox failure/timeout destroys the micro-VM; the runner falls
      // back to the Target_Parser and emits a skip-note (R5.6/R10.5).
      await this.dispose();
      if (cause instanceof NecroError) throw cause;
      throw new NecroError(
        "UPSTREAM_UNAVAILABLE",
        "The far crypt will not answer. (sandbox parse-check unavailable)",
        cause,
      );
    }
  }

  async dispose(): Promise<void> {
    const sandbox = this.#sandbox;
    this.#sandbox = null;
    this.#opening = null;
    if (sandbox === null) return;
    try {
      await sandbox.kill();
    } catch {
      // Best-effort teardown: a kill failure must not mask the primary result.
    }
  }

  #ensureSandbox(timeoutMs: number): Promise<E2bSandboxLike> {
    if (this.#sandbox !== null) return Promise.resolve(this.#sandbox);
    if (this.#opening !== null) return this.#opening;
    const lifetime = this.#cfg.maxLifetimeMs ?? DEFAULT_MAX_LIFETIME_MS;
    const opening = this.#openSandbox(Math.max(timeoutMs, lifetime));
    this.#opening = opening;
    return opening.then(
      (sandbox) => {
        this.#sandbox = sandbox;
        this.#opening = null;
        return sandbox;
      },
      (err) => {
        this.#opening = null;
        throw err;
      },
    );
  }

  async #openSandbox(timeoutMs: number): Promise<E2bSandboxLike> {
    // Dynamic import keeps the SDK off the default/local path: the module is
    // only loaded when E2B is actually configured and a check is requested.
    // The specifier is held in a variable so the compiler does not statically
    // resolve `e2b` — the SDK is an optional peer the local path never needs.
    const mod = (await import(E2B_MODULE_ID)) as unknown as E2bModuleLike;
    return mod.Sandbox.create({
      apiKey: this.#cfg.apiKey,
      template: this.#cfg.template ?? DEFAULT_TEMPLATE,
      timeoutMs,
    });
  }
}
