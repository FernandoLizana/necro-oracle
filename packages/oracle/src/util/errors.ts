// @necro/oracle — NecroError and error code constants.
// Typed errors per the design Data Models section: every NecroError carries a
// machine-readable `code`, an oracle-voice `userMessage`, and an optional `cause`.
import { z } from "zod";

export const NecroErrorCodeSchema = z.enum([
  "REGISTRY_INVALID",
  "CARD_NOT_FOUND",
  "PARSER_INIT_FAILED",
  "FILE_TOO_LARGE",
  "INVALID_QUERY_PATTERN",
  "SNAPSHOT_DIR_NOT_FOUND",
  "INVALID_REPO_META",
  "DETECTOR_FAILED",
  "INVALID_REPO_URL",
  "REPO_NOT_FOUND",
  "REPO_PRIVATE",
  "RATE_LIMITED",
  "NETWORK_TIMEOUT",
  "DOWNLOAD_TOO_LARGE",
  "VALIDATION_FAILED",
  "REF_NOT_FOUND",
  "AUTH_INVALID",
  "UPSTREAM_UNAVAILABLE",
]);

export type NecroErrorCode = z.infer<typeof NecroErrorCodeSchema>;

export class NecroError extends Error {
  readonly code: NecroErrorCode;
  readonly userMessage: string; // Oracle-voice message shown to users
  override readonly cause?: unknown;

  constructor(code: NecroErrorCode, userMessage: string, cause?: unknown) {
    super(userMessage);
    this.name = "NecroError";
    this.code = code;
    this.userMessage = userMessage;
    this.cause = cause;
  }
}
