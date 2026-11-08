// Safe self-check for the deployment. Never returns secret values, only whether they look right.
import { NextResponse } from "next/server";
import { clean } from "../../../lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const key = clean(process.env.AGENT_PRIVATE_KEY);
  const rawKey = process.env.AGENT_PRIVATE_KEY ?? "";
  const llm = clean(process.env.LLM_API_KEY);
  return NextResponse.json({
    contract: clean(process.env.NEXT_PUBLIC_LEASH_CONTRACT) || "MISSING",
    agentAccount: clean(process.env.AGENT_ACCOUNT) || "MISSING",
    agentKey: {
      present: key.length > 0,
      startsWithEd25519: key.startsWith("ed25519:"),
      length: key.length, // a NEAR private key is about 96
      hadExtraCharacters: rawKey.length !== key.length,
    },
    llmKey: { present: llm.length > 0, startsWithGsk: llm.startsWith("gsk_"), length: llm.length },
    rpc: process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com",
  });
}
