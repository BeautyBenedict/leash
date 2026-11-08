// Build the agent's key pair directly, without the library's "<curve>:<key>" text parser (the part that throws "Unknown curve").
import { utils } from "near-api-js";
import { clean } from "./env";

export function agentKeyPair(raw: string | undefined) {
  const k = clean(raw);
  const secret = k.toLowerCase().startsWith("ed25519:") ? k.slice(8) : k;
  return new utils.KeyPairEd25519(secret);
}
