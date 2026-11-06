// @necro/sandbox — SandboxPort + providers (e2b, docker), allowlist
export const SANDBOX_VERSION = "0.0.0";

// --- Command allowlist (security: only sanctioned parse-only commands run) ---
export {
  SANDBOX_ALLOWLIST,
  PY_COMPILE_ARGV,
  CANDIDATE_PATH,
  allowlistedArgv,
  isAllowlisted,
  type SandboxCommandId,
} from "./allowlist.js";

// --- Optional E2B parse-only provider (guarded behind config presence) -------
export {
  E2bSandboxPort,
  createE2bSandboxPort,
  isE2bConfigured,
  type E2bConfig,
} from "./providers/e2b.js";
