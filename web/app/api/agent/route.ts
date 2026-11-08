// Scenario buttons: the demo agent asks the Leash contract to pay. The contract's rules decide the outcome.
import { NextResponse } from "next/server";
import { agentConfigured, requestPayment } from "../../../lib/payments";
import { limited } from "../../../lib/limit";
import { validatePayment } from "../../../lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!agentConfigured())
    return NextResponse.json({ error: "Demo agent is not configured. Set AGENT_ACCOUNT and AGENT_PRIVATE_KEY." }, { status: 500 });
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
  const bad = validatePayment(to, amount);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });

  try {
    const outcome = await requestPayment(to, amount, String(body.memo ?? "demo payment"));
    return NextResponse.json({ outcome });
  } catch (e) {
    const err = e as Error;
    const frames = (err.stack ?? "").split("\n").slice(1, 4).map((l) => l.trim().replace(/\(.*node_modules\//, "(")).join(" | ");
    return NextResponse.json({ error: `Agent call failed: ${String(err.message ?? e).slice(0, 160)} [${frames}]` }, { status: 502 });
  }
}
