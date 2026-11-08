// Safe self-check for the deployment. Never returns secret values, only whether they look right.
import { NextResponse } from "next/server";
import { clean } from "../../../lib/env";
import { agentKeyPair } from "../../../lib/key";
import { connect, keyStores } from "near-api-js";

export const dynamic = "force-dynamic";

async function stage(name: string, fn: () => Promise<unknown>) {
  try {
    return { stage: name, ok: true, result: await fn() };
  } catch (e) {
    const err = e as Error;
    const frames = (err.stack ?? "").split("\n").slice(1, 5).map((l) => l.trim().replace(/\(.*node_modules\//, "(node_modules/"));
    return { stage: name, ok: false, error: String(err.message ?? e).slice(0, 200), frames };
  }
}

// /api/health?probe=1 runs the agent's transaction steps one by one (no payment is made) so a failure shows which step breaks.
async function probe() {
  const AGENT = clean(process.env.AGENT_ACCOUNT);
  const rawKey = process.env.AGENT_PRIVATE_KEY ?? "";
  const nodeUrl = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
  const out: unknown[] = [];
  const keyStore = new keyStores.InMemoryKeyStore();
  let conn: Awaited<ReturnType<typeof connect>> | undefined;
  let pub = "";
  out.push(await stage("1 build key pair", async () => { pub = agentKeyPair(rawKey).getPublicKey().toString(); return pub; }));
  out.push(await stage("2 put key in key store", async () => { await keyStore.setKey("testnet", AGENT, agentKeyPair(rawKey)); return "ok"; }));
  out.push(await stage("3 connect", async () => { conn = await connect({ networkId: "testnet", keyStore, nodeUrl }); return "ok"; }));
  out.push(await stage("4 signer reads key back", async () => (await conn!.connection.signer.getPublicKey(AGENT, "testnet")).toString()));
  out.push(await stage("5 sign a test message (offline)", async () => { await conn!.connection.signer.signMessage(new Uint8Array([1, 2, 3]), AGENT, "testnet"); return "ok"; }));
  out.push(await stage("6 ask the network about the agent key", async () => {
    const r: any = await conn!.connection.provider.query({ request_type: "view_access_key", finality: "final", account_id: AGENT, public_key: pub });
    return { permission: typeof r.permission === "string" ? r.permission : "function-call", nonce: String(r.nonce) };
  }));
  return out;
}

export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get("probe")) return NextResponse.json({ build: "key-fix-2", probe: await probe() });
  const rawKey = process.env.AGENT_PRIVATE_KEY ?? "";
  const key = clean(rawKey);
  const llm = clean(process.env.LLM_API_KEY);
  let keyCheck: Record<string, unknown>;
  try {
    // The public key is not secret. It should equal the agent account's public key on testnet.
    keyCheck = { ok: true, publicKey: agentKeyPair(rawKey).getPublicKey().toString() };
  } catch (e) {
    keyCheck = { ok: false, error: String(e).slice(0, 160) };
  }
  return NextResponse.json({
    build: "key-fix-2",
    contract: clean(process.env.NEXT_PUBLIC_LEASH_CONTRACT) || "MISSING",
    agentAccount: clean(process.env.AGENT_ACCOUNT) || "MISSING",
    agentKey: {
      present: key.length > 0,
      startsWithEd25519: key.startsWith("ed25519:"),
      length: key.length, // a NEAR private key is about 96
      hadExtraCharacters: rawKey.length !== key.length,
      keyCheck,
    },
    llmKey: { present: llm.length > 0, startsWithGsk: llm.startsWith("gsk_"), length: llm.length },
    rpc: process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com",
  });
}
