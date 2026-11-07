// @necro/llm — zod -> OpenAI-strict JSON Schema generator (R43.1).
//
// `toStrictJsonSchema(name, schema)` turns a step's zod schema into the
// `response_format.json_schema` body OpenRouter/OpenAI structured outputs
// expect. There is NO hand-written JSON Schema: the shape is derived from the
// zod schema with `zod-to-json-schema`, then post-processed into OpenAI-strict
// form so a provider that supports strict structured output accepts it.
//
// OpenAI-strict form, enforced here recursively over every object node:
//   - every property is listed in `required` (strict mode has no notion of an
//     optional property; optionality is modelled by the zod schema post-parse);
//   - `additionalProperties: false`;
//   - keywords OpenAI-strict rejects are STRIPPED from the wire schema (see
//     STRIPPED_KEYWORDS below). Those are validation bounds (min/max, lengths,
//     formats, patterns); they are re-enforced by zod when the parsed output is
//     run back through `schema.safeParse` in `parseStructured`, so validation
//     strength is unchanged — the wire schema is only a generation guide.
//   - `description` is preserved: a field's zod `.describe(...)` text rides
//     through `zod-to-json-schema` onto the property and guides the model.
//
// Pure: no network, no clock, no I/O. The only dependency is the pure
// `zod-to-json-schema` transform.

import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * JSON Schema keywords OpenAI structured-output *strict* mode rejects, stripped
 * from the generated wire schema and re-enforced by zod POST-parse instead.
 *
 * Numeric bounds:   `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`,
 *                   `multipleOf`
 * String bounds:    `minLength`, `maxLength`, `pattern`, `format`
 * Array bounds:     `minItems`, `maxItems`, `uniqueItems`
 * Object bounds:    `minProperties`, `maxProperties`, `patternProperties`
 *
 * These are the length/range/format assertions zod re-checks on the parsed
 * object; dropping them from the wire schema keeps the schema strict-compatible
 * without weakening validation. `type`, `enum`, `const`, `properties`, `items`,
 * `required`, `additionalProperties`, `description`, `$ref`, `$defs`, `anyOf`,
 * `allOf`, `oneOf` and `$schema`-less structural keywords are preserved.
 */
export const STRIPPED_KEYWORDS: readonly string[] = [
  // numeric
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  // string
  "minLength",
  "maxLength",
  "pattern",
  "format",
  // array
  "minItems",
  "maxItems",
  "uniqueItems",
  // object
  "minProperties",
  "maxProperties",
  "patternProperties",
];

const STRIPPED = new Set<string>(STRIPPED_KEYWORDS);

/** The `response_format.json_schema` body for a strict structured-output call. */
export interface StrictJsonSchema {
  readonly name: string;
  readonly strict: true;
  readonly schema: Record<string, unknown>;
}

/**
 * Recursively post-process a JSON Schema node into OpenAI-strict form:
 * drop every stripped keyword, and for every object node mark all of its
 * properties `required` and forbid additional properties. Returns a fresh node;
 * the input is not mutated.
 */
function strictify(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => strictify(item));
  }
  if (node === null || typeof node !== "object") {
    return node;
  }

  const source = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (STRIPPED.has(key)) continue;
    // Recurse into every retained keyword's value so nested objects, array
    // `items`, and `$defs` entries are strictified too.
    out[key] = strictify(value);
  }

  // Any object node (explicitly typed "object", or one carrying `properties`)
  // must list ALL its properties as required and forbid extras.
  const isObjectNode =
    out["type"] === "object" ||
    (out["properties"] !== undefined && typeof out["properties"] === "object");

  if (isObjectNode) {
    const properties = out["properties"];
    if (properties !== null && typeof properties === "object") {
      out["required"] = Object.keys(properties as Record<string, unknown>);
    } else {
      out["required"] = [];
    }
    out["additionalProperties"] = false;
  }

  return out;
}

/**
 * Generate the OpenAI-strict `response_format.json_schema` body from a zod
 * schema. The returned `schema` has every object's properties `required`,
 * `additionalProperties: false`, the keywords in {@link STRIPPED_KEYWORDS}
 * removed, and each field's `.describe(...)` text carried through.
 *
 * `name` is the structured-output schema name the provider echoes back; it
 * matches the per-purpose output schema name in the prompt catalogue.
 *
 * Pure: deterministic for a given schema, no side effects.
 */
export function toStrictJsonSchema(
  name: string,
  schema: ZodType<unknown>,
): StrictJsonSchema {
  // `$refStrategy: "none"` inlines definitions so the strictify pass sees a
  // single self-contained tree (no `$ref` indirection to a `definitions` root).
  const raw = zodToJsonSchema(schema, {
    $refStrategy: "none",
    target: "jsonSchema7",
  }) as Record<string, unknown>;

  // Drop the dialect marker: OpenAI-strict does not want a `$schema` on the
  // embedded schema body.
  delete raw["$schema"];

  const schemaBody = strictify(raw) as Record<string, unknown>;

  return { name, strict: true, schema: schemaBody };
}
