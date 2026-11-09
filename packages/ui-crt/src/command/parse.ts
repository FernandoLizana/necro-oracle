// Total, side-effect-free command parser for the CRT Terminal.
//
// Validates: Requirements R2.1, R2.2, R2.3, R2.4, R2.5, R2.6, R2.9, R2.10,
// R2.11, R2.12, R2.16; lovers-binding R14.1, R14.2, R25.1, R25.5, R25.6, R25.7
//
// `parseCommand` accepts every input string and returns a `Command` or `null`
// (for an empty or whitespace-only entry) without ever throwing and without
// reading the clock, environment, network or DOM.

import { CardIdSchema, type CardId } from "@necro/oracle/client";
import type {
  Command,
  CommandMotionArg,
  CommandSoundArg,
  KeyOp,
  ModelTierArg,
  ResurrectTarget,
  SpreadArg,
} from "./types.js";

/** The three spread names `read` accepts. */
const SPREAD_ARGS: readonly SpreadArg[] = ["fates", "necropsy", "celtic"];

/** The three motion preferences. */
const MOTION_ARGS: readonly CommandMotionArg[] = ["auto", "on", "off"];

/** The two sound preferences. */
const SOUND_ARGS: readonly CommandSoundArg[] = ["on", "off"];

/** Demo names: lowercase token `^[a-z0-9-]{1,32}$`. */
const DEMO_NAME_RE = /^[a-z0-9-]{1,32}$/;

/**
 * `owner/repo` over `[A-Za-z0-9_.-]`, with an optional `#ref` or `@sha`
 * suffix. Each segment must be non-empty.
 */
const OWNER_REPO_RE =
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:[#@][A-Za-z0-9_.-]+)?$/;

/**
 * A `github.com` / `www.github.com` URL carrying an owner and a repo segment.
 * Scheme is optional; a trailing path/query/fragment is allowed.
 */
const GITHUB_URL_RE =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:[/#@?].*)?$/;

/**
 * The `lovers` target languages recognised today. `js` and `javascript` both
 * normalise to the canonical `"javascript"` (lovers-binding R14.1); the
 * language pair is parameterized so future targets can be added here, but any
 * other token is rejected with `unknown`.
 */
const LOVERS_LANGS: Readonly<Record<string, "javascript">> = {
  js: "javascript",
  javascript: "javascript",
};

/** The three `key` operations (lovers-binding R25.1, design Â§D.2). */
const KEY_OPS: readonly KeyOp[] = ["set", "status", "clear"];

/** The two `model` tiers (lovers-binding R25.5, R25.6, design Â§A.3). */
const MODEL_TIERS: readonly ModelTierArg[] = ["fast", "strong"];

/**
 * Safe OpenRouter model-id pattern (lovers-binding design decision 6, R25.7).
 *
 * Accepts `vendor/model` with an OPTIONAL leading `~` routing hint and an
 * OPTIONAL `:tag` suffix (e.g. `:free`, `:nitro`), over a restricted charset,
 * total length â‰¤ 128. Rejects whitespace, control chars, `..`, a bare vendor,
 * and leading/trailing separators.
 *
 * Exported so task 11's server-side request schema validates the SAME pattern
 * (`ModelOverridesSchema` in `apps/web`), keeping the client and server in sync.
 */
// vendor/model with optional leading ~ and optional :tag; total length capped at 128.
export const MODEL_ID_RE =
  /^(?=.{1,128}$)~?[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[a-z0-9]+(?:[._-][a-z0-9]+)*)?$/i;

/**
 * Light recognition of a bare repo reference. Full validity is the server's
 * job (`parseRepoRef`); this only decides whether a single bare token should be
 * treated as a `summon`.
 */
export function looksLikeRepoRef(token: string): boolean {
  return GITHUB_URL_RE.test(token) || OWNER_REPO_RE.test(token);
}

function unknown(raw: string): Command {
  return { kind: "unknown", raw };
}

/**
 * Discriminate a single `resurrect` argument token into a {@link
 * ResurrectTarget} at the parse level only. A token containing a `/` or ending
 * in `.py` is a file path (R1.3), its case preserved because paths are
 * case-sensitive; any other token is a card id (R1.2), lowercased to match the
 * canonical card-id casing (mirrors `explain`). Semantic validation â€”
 * card/file existence and Python-2 classification â€” is the server's job, so no
 * `CardIdSchema` check happens here. Returns `null` for an empty token so the
 * caller can reject `resurrect ""`-style input; tokenization already strips
 * surrounding whitespace, so a present-but-empty token cannot otherwise arise.
 */
export function parseResurrectTarget(token: string): ResurrectTarget | null {
  if (token.length === 0) return null;
  if (token.includes("/") || token.endsWith(".py")) {
    return { kind: "file", path: token };
  }
  return { kind: "card", card: token.toLowerCase() };
}

/**
 * Parse a single terminal entry into a {@link Command}.
 *
 * Returns `null` for an empty or whitespace-only entry (R2.10). Otherwise the
 * entry is trimmed and split on Unicode whitespace; the first token is matched
 * case-insensitively against the eight command names. Any mismatch yields an
 * `unknown` carrying the trimmed raw entry (R2.11). Totality: never throws.
 */
export function parseCommand(input: string): Command | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const tokens = trimmed.split(/\s+/u);
  const name = (tokens[0] ?? "").toLowerCase();
  const args = tokens.slice(1);

  switch (name) {
    case "help":
      return args.length === 0 ? { kind: "help" } : unknown(trimmed);

    case "clear":
      return args.length === 0 ? { kind: "clear" } : unknown(trimmed);

    case "home":
      return args.length === 0 ? { kind: "home" } : unknown(trimmed);

    case "summon": {
      // The repo argument is the raw second token, unchanged. Exactly one
      // argument is allowed.
      if (args.length !== 1) return unknown(trimmed);
      return { kind: "summon", repo: args[0]! };
    }

    case "read": {
      if (args.length === 0) return { kind: "read", spread: "necropsy" };
      if (args.length !== 1) return unknown(trimmed);
      const spread = args[0]!.toLowerCase();
      if ((SPREAD_ARGS as readonly string[]).includes(spread)) {
        return { kind: "read", spread: spread as SpreadArg };
      }
      return unknown(trimmed);
    }

    case "explain": {
      if (args.length !== 1) return unknown(trimmed);
      const target = args[0]!.toLowerCase();
      // Positive integer position (1-based).
      if (/^[0-9]+$/.test(target)) {
        const position = Number.parseInt(target, 10);
        if (Number.isSafeInteger(position) && position >= 1) {
          return { kind: "explain", target: { kind: "position", position } };
        }
        return unknown(trimmed);
      }
      // A CardId.
      const parsed = CardIdSchema.safeParse(target);
      if (parsed.success) {
        return {
          kind: "explain",
          target: { kind: "card", card: parsed.data as CardId },
        };
      }
      return unknown(trimmed);
    }

    case "resurrect": {
      // Bare `resurrect` resurrects every Python-2 candidate (R1.4).
      if (args.length === 0) {
        return { kind: "resurrect", target: { kind: "bare" } };
      }
      // Exactly one argument is allowed; extra tokens are rejected.
      if (args.length !== 1) return unknown(trimmed);
      const target = parseResurrectTarget(args[0]!);
      return target === null ? unknown(trimmed) : { kind: "resurrect", target };
    }

    case "motion": {
      if (args.length === 0) return { kind: "motion" };
      if (args.length !== 1) return unknown(trimmed);
      const arg = args[0]!.toLowerCase();
      if ((MOTION_ARGS as readonly string[]).includes(arg)) {
        return { kind: "motion", arg: arg as CommandMotionArg };
      }
      return unknown(trimmed);
    }

    case "demo": {
      if (args.length === 0) return { kind: "demo" };
      if (args.length !== 1) return unknown(trimmed);
      const demoName = args[0]!.toLowerCase();
      if (DEMO_NAME_RE.test(demoName)) {
        return { kind: "demo", name: demoName };
      }
      return unknown(trimmed);
    }

    case "sound": {
      if (args.length === 0) return { kind: "sound" };
      if (args.length !== 1) return unknown(trimmed);
      const arg = args[0]!.toLowerCase();
      if ((SOUND_ARGS as readonly string[]).includes(arg)) {
        return { kind: "sound", arg: arg as CommandSoundArg };
      }
      return unknown(trimmed);
    }

    case "tarot": {
      // `tarot [question...]` — the optional question is the FREE-TEXT rest of
      // the entry (everything after the command word), not a single token, so a
      // seeker can ask a real question. It is untrusted DATA; the server treats
      // it as such and never as instructions. Empty => omitted entirely.
      if (args.length === 0) return { kind: "tarot" };
      const question = args.join(" ").slice(0, 200);
      return { kind: "tarot", question };
    }

    case "lovers": {
      // `lovers <file> <lang>` takes EXACTLY two args (R14.1). The language is
      // matched case-insensitively and normalised to `"javascript"`; the file
      // token keeps its ORIGINAL case because paths are case-sensitive.
      if (args.length !== 2) return unknown(trimmed);
      const targetLang = LOVERS_LANGS[args[1]!.toLowerCase()];
      if (targetLang === undefined) return unknown(trimmed);
      return { kind: "lovers", file: args[0]!, targetLang };
    }

    case "key": {
      // `key set|status|clear` takes EXACTLY one op from the set (R25.1),
      // matched case-insensitively.
      if (args.length !== 1) return unknown(trimmed);
      const op = args[0]!.toLowerCase();
      if ((KEY_OPS as readonly string[]).includes(op)) {
        return { kind: "key", op: op as KeyOp };
      }
      return unknown(trimmed);
    }

    case "model": {
      // `model fast|strong <id>` takes EXACTLY two args: the tier (R25.5,
      // R25.6, matched case-insensitively) and the `<id>` validated against the
      // shared `MODEL_ID_RE` (R25.7). The id keeps its original case (the regex
      // is case-insensitive and ids are opaque to the parser).
      if (args.length !== 2) return unknown(trimmed);
      const tier = args[0]!.toLowerCase();
      if (!(MODEL_TIERS as readonly string[]).includes(tier)) {
        return unknown(trimmed);
      }
      const id = args[1]!;
      if (!MODEL_ID_RE.test(id)) return unknown(trimmed);
      return { kind: "model", tier: tier as ModelTierArg, id };
    }

    default: {
      // A single bare token that looks like a repo reference summons it.
      if (tokens.length === 1 && looksLikeRepoRef(tokens[0]!)) {
        return { kind: "summon", repo: tokens[0]! };
      }
      return unknown(trimmed);
    }
  }
}
