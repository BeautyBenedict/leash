// Demo agent: tries a sequence of payments against the Leash contract and
// prints what the policy did with each. Each scenario has an expected outcome.
//
// Env (see ../.env.example):
//   LEASH_CONTRACT, AGENT_ACCOUNT, AGENT_PRIVATE_KEY (ed25519:...),
//   VENDOR_ACCOUNT, SCAM_ACCOUNT
import { connect, keyStores, KeyPair } from "near-api-js";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var ${k}`);
  return v;
};

const CONTRACT = need("LEASH_CONTRACT");
const AGENT = need("AGENT_ACCOUNT");
const KEY = need("AGENT_PRIVATE_KEY");
const VENDOR = need("VENDOR_ACCOUNT");
const SCAM = need("SCAM_ACCOUNT");

const near = (n: number) => BigInt(Math.round(n * 1000)) * 10n ** 21n; // n NEAR in yocto

const scenarios = [
  { name: "Pay vendor 1 NEAR", to: VENDOR, amount: 1, expect: "Paid" },
  { name: "Pay vendor 6 NEAR (over per-tx limit)", to: VENDOR, amount: 6, expect: "Denied" },
  { name: "Pay unlisted scam wallet 1 NEAR", to: SCAM, amount: 1, expect: "Denied" },
  { name: "Pay vendor 3 NEAR (over approval threshold)", to: VENDOR, amount: 3, expect: "PendingApproval" },
] as const;

async function main() {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey("testnet", AGENT, KeyPair.fromString(KEY as `ed25519:${string}`));
  const conn = await connect({
    networkId: "testnet",
    keyStore,
    nodeUrl: "https://test.rpc.fastnear.com",
  });
  const account = await conn.account(AGENT);

  for (const s of scenarios) {
    // `functionCall` returns the contract's return value via the final status.
    const res: any = await account.functionCall({
      contractId: CONTRACT,
      methodName: "request_payment",
      args: { to: s.to, amount: near(s.amount).toString(), memo: s.name },
      gas: 100_000_000_000_000n as any,
    });
    const raw = res.status?.SuccessValue;
    const outcome = raw ? JSON.parse(Buffer.from(raw, "base64").toString()) : "unknown";
    const got = typeof outcome === "string" ? outcome : Object.keys(outcome)[0];
    const ok = got === s.expect ? "OK " : "BAD";
    console.log(`[${ok}] ${s.name} -> ${JSON.stringify(outcome)} (expected ${s.expect})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
