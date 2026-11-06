// @necro/sandbox — command allowlist for the E2B micro-VM.
//
// Security rule 1 & 3: repository code is untrusted data. Inside the sandbox we
// run ONLY the fixed, parse-only (compile-only) commands listed here. Nothing
// else may ever reach the sandbox shell. A command is admissible iff it is one
// of these exact argv tuples — no string interpolation of repository content
// into a shell line, no user-supplied flags. Repository source is delivered as
// a file the command reads; it is never passed as code to execute.

/**
 * The compile-only Python 3 check. `py_compile` byte-compiles a source file to
 * verify it parses as valid Python 3; it imports and runs nothing in the file,
 * so no repository code is executed. The target path is fixed (we write the
 * candidate to this path inside the sandbox before invoking the check).
 */
export const PY_COMPILE_ARGV: readonly string[] = Object.freeze([
  "python3",
  "-m",
  "py_compile",
  "/tmp/necro/candidate.py",
]);

/** Fixed in-sandbox path the candidate source is written to before the check. */
export const CANDIDATE_PATH = "/tmp/necro/candidate.py";

/**
 * Every argv tuple the sandbox is permitted to run, keyed by a stable id. The
 * runner looks a command up by id; it never constructs one from free text.
 */
export const SANDBOX_ALLOWLIST: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    py_compile: PY_COMPILE_ARGV,
  });

/** Allowlisted command identifiers. */
export type SandboxCommandId = keyof typeof SANDBOX_ALLOWLIST;

/**
 * Returns the frozen argv for an allowlisted command id, or `undefined` if the
 * id is not on the allowlist. Callers MUST refuse any command that is not here.
 */
export function allowlistedArgv(
  id: string,
): readonly string[] | undefined {
  return Object.prototype.hasOwnProperty.call(SANDBOX_ALLOWLIST, id)
    ? SANDBOX_ALLOWLIST[id]
    : undefined;
}

/** True iff `id` names an allowlisted command. */
export function isAllowlisted(id: string): id is SandboxCommandId {
  return Object.prototype.hasOwnProperty.call(SANDBOX_ALLOWLIST, id);
}
