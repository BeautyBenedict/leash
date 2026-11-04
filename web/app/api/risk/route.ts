// Recipient risk check. v0 is a transparent rule-based scorer so the demo never
// depends on an external service. The TODO below is where the Vouch-style
// wallet trust check plugs in.
import { NextResponse } from "next/server";

// Demo deny-list. Replace with real threat intel / Vouch scoring.
const KNOWN_BAD = new Set<string>(["scam-wallet.testnet", "free-near-giveaway.testnet"]);
const SUSPICIOUS_WORDS = ["giveaway", "airdrop", "claim", "support", "verify", "wallet-connect"];

function scoreAccount(account: string): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (KNOWN_BAD.has(account)) {
    score = 100;
    reasons.push("on known-bad list");
  }
  for (const w of SUSPICIOUS_WORDS) {
    if (account.includes(w)) {
      score += 30;
      reasons.push(`name contains "${w}"`);
    }
  }
  if (/\d{8,}/.test(account)) {
    score += 20;
    reasons.push("long numeric string in name");
  }
  // TODO: call Vouch / onchain history (account age, tx count, counterparties).
  return { score: Math.min(score, 100), reasons };
}

export async function GET(req: Request) {
  const account = new URL(req.url).searchParams.get("account");
  if (!account) return NextResponse.json({ error: "account required" }, { status: 400 });
  return NextResponse.json({ account, ...scoreAccount(account) });
}
