#!/usr/bin/env node
// PreToolUse guard: blocks any write to a .env* file (security.md rule 8).
// Reads the hook event JSON on stdin. Exit 0 = allow, exit 2 = deny (stderr goes to the agent).
// Fails closed: an unreadable event is denied.
import { readFileSync } from "node:fs";

const ENV_NAME = /^\.env(\..*)?$/i;
const ENV_TOKEN = /(^|[\s"'`=(\/\\])\.env(\.[\w.-]+)?(?=$|[\s"'`;|&)<>,])/i;
const READ_ONLY_TOOL = /(^|[_\-.\/])(read|list|search|grep|glob|find|fetch|get|view|status)/i;
const SHELL_TOOL = /shell|bash|pwsh|powershell|exec|command|terminal/i;
const SHELL_WRITE =
  /(?<![<>=-])>{1,2}(?!=)|\b(set-content|add-content|out-file|new-item|copy-item|move-item|rename-item|remove-item|tee(-object)?|cp|mv|rm|del|copy|move|ren|touch|writealltext|appendalltext|sed\s+-i)\b/i;

function deny(reason) {
  process.stderr.write(`Blocked by block-env-writes hook: ${reason} Never create or edit .env files; use environment variables validated in packages/config.\n`);
  process.exit(2);
}

/** Every string value under a path-like key, at any depth. */
function pathValues(value, key = "", out = []) {
  if (typeof value === "string") {
    if (/path|file|target|dest|uri|name/i.test(key)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) pathValues(v, key, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) pathValues(v, k, out);
  }
  return out;
}

/** Every string value, at any depth (for shell command text). */
function allStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) allStrings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) allStrings(v, out);
  return out;
}

const isEnvPath = (p) => ENV_NAME.test(p.trim().replace(/["']/g, "").split(/[\\/]/).pop() ?? "");

let event;
try {
  event = JSON.parse(readFileSync(0, "utf8"));
} catch {
  deny("could not parse the hook event.");
}

const tool = String(event?.tool_name ?? "");
const input = event?.tool_input ?? {};

if (SHELL_TOOL.test(tool)) {
  for (const cmd of allStrings(input)) {
    if (ENV_TOKEN.test(cmd) && SHELL_WRITE.test(cmd)) deny("this shell command writes to a .env file.");
  }
  process.exit(0);
}

if (READ_ONLY_TOOL.test(tool)) process.exit(0);

const hit = pathValues(input).find(isEnvPath);
if (hit !== undefined) deny(`"${tool}" targets a .env file.`);
process.exit(0);