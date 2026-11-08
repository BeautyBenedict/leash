// Server-only: the agent account asks the Leash contract to pay. The agent key never reaches the browser.
import { connect, keyStores, KeyPair } from "near-api-js";
import { nearToYocto } from "./validate";

export type Outcome = "Paid" | { PendingApproval: { id: number } } | { Denied: { reason: string } };

const CONTRACT = process.env.NEXT_PUBLIC_LEASH_CONTRACT ?? "";
const AGENT = process.env.AGENT_ACCOUNT ?? "";
const KEY = process.env.AGENT_PRIVATE_KEY ?? "";

export function agentConfigured(): boolean {
  return !!(CONTRACT && AGENT && KEY);
}

export async function requestPayment(to: string, amountNear: string, memo: string): Promise<Outcome> {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey("testnet", AGENT, KeyPair.fromString(KEY as `ed25519:${string}`));
  const conn = await connect({
    networkId: "testnet",
    keyStore,
    nodeUrl: process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com",
  });
  const account = await conn.account(AGENT);
  const res: any = await account.functionCall({
    contractId: CONTRACT,
    methodName: "request_payment",
    args: { to: to.trim().toLowerCase(), amount: nearToYocto(amountNear), memo: memo.slice(0, 80) },
    gas: 100_000_000_000_000n as any,
  });
  const raw = res.status?.SuccessValue;
  if (!raw) throw new Error("The contract returned no result");
  return JSON.parse(Buffer.from(raw, "base64").toString());
}
