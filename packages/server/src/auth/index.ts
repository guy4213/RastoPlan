// Auth stub (spec 12.3): one shared office password via env var, no per-user
// accounts/roles in MVP. Real session/JWT issuance lands in Milestone 3.
import type { ServerConfig } from "../config.js";

export interface LoginResult {
  token: string;
}

export function verifyOfficePassword(_password: string, _config: ServerConfig): LoginResult {
  throw new Error("not implemented: auth lands in Milestone 3");
}
