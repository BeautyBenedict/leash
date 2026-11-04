// Demo AI agent. The agent's key lives on the server (env vars) and is never sent to the browser.
// The agent can only ASK the Leash contract to pay; the contract's rules decide the outcome.
import { NextResponse } from "next/server";
import { connect, keyStores, KeyPair } from "near-api-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTRACT = process.env.NEXT_PUBLIC_LEASH_CONTRACT ?? "";
const AGENT = process.env.AGENT_ACCOUNT ?? "";
const KEY = process.env.AGENT_PRIVATE_KEY ?? "";

// Very small in-memory rate limit (per server instance) so a public demo can't drain the vault.
const hits = new Map<string, number[]>();
const PER_IP_PER_MIN = 6;
let globalHits: number[] = [];
const GLOBAL_PER_HOUR = 60;

function limited(ip: string): boolean {
  const now = Date.now();
  const mine = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  globalHits = globalHits.filter((t) => now - t < 3_600_000);
  if (mine.length >= PER_IP_PER_MIN || globalHits.length >= GLOBAL_PER_HOUR) return true;
  mine.push(now);
  globalHits.push(now);
  hits.set(ip, mine);
  return false;
}

const ACCOUNT_RE = /^[a-z0-9._-]{2,64}$/;

function nearToYocto(v: string): string {
  const [w, f = ""] = v.split(".");
  return (BigInt(w || "0") * 10n ** 24n + BigInt((f + "0".repeat(24)).slice(0, 24))).toString();
}

export async function POST(req: Request) {
  if (!CONTRACT || !AGENT || !KEY) {
    return NextResponse.json(
      { error: "Demo agent is not configured. Set AGENT_ACCOUNT and AGENT_PRIVATE_KEY in web/.env.local." },
      { status: 500 },
    );
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limited(ip)) return NextResponse.json({ error: "Slow down: too many demo requests. Try again in a minute." }, { status: 429 });

  let body: { to?: string; amount?: string; memo?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const to = String(body.to ?? "").trim().toLowerCase();
  const amount = String(body.amount ?? "").trim();
  const memo = String(body.memo ?? "demo payment").slice(0, 80);
  if (!ACCOUNT_RE.test(to)) return NextResponse.json({ error: "Recipient must be a valid NEAR account name." }, { status: 400 });
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(amount) || Number(amount) <= 0)
    return NextResponse.json({ error: "Amount must be a number like 1 or 2.5 (max 999)." }, { status: 400 });

  try {
    const keyStore = new keyStores.InMemoryKeyStore();
    await keyStore.setKey("testnet", AGENT, KeyPair.fromString(KEY as `ed25519:${string}`));
    const conn = await connect({ networkId: "testnet", keyStore, nodeUrl: process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com" });
    const account = await conn.account(AGENT);
    const res: any = await account.functionCall({
      contractId: CONTRACT,
      methodName: "request_payment",
      args: { to, amount: nearToYocto(amount), memo },
      gas: 100_000_000_000_000n as any,
    });
    const raw = res.status?.SuccessValue;
    const outcome = raw ? JSON.parse(Buffer.from(raw, "base64").toString()) : null;
    return NextResponse.json({ outcome });
  } catch (e) {
    return NextResponse.json({ error: `Agent call failed: ${String(e).slice(0, 200)}` }, { status: 502 });
  }
}
