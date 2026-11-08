// "Ask the AI agent": a real language model reads the instruction and decides which payments to attempt.
// The Leash contract, not the model, enforces limits, allowlist, risk checks and owner approval.
import { NextResponse } from "next/server";
import { agentConfigured, requestPayment } from "../../../../lib/payments";
import { clean } from "../../../../lib/env";
import { limited } from "../../../../lib/limit";
import { runAgent, TOOLS, type LlmFn } from "../../../../lib/agent-loop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Any OpenAI-compatible provider works. Defaults to Groq's free tier.
const BASE = process.env.LLM_BASE_URL ?? "https://api.groq.com/openai/v1";
const KEY = clean(process.env.LLM_API_KEY);
const MODEL = process.env.LLM_MODEL ?? "openai/gpt-oss-120b";

const llm: LlmFn = async (messages) => {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, messages, tools: TOOLS, tool_choice: "auto", temperature: 0.2, max_tokens: 500 }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Model error ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const json = await res.json();
  return json.choices[0].message;
};

export async function POST(req: Request) {
  if (!KEY) return NextResponse.json({ error: "The AI model is not configured. Set LLM_API_KEY." }, { status: 500 });
  if (!agentConfigured()) return NextResponse.json({ error: "Demo agent is not configured." }, { status: 500 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limited(ip, 4, 40)) return NextResponse.json({ error: "Slow down: too many requests. Try again in a minute." }, { status: 429 });

  let message = "";
  try {
    message = String((await req.json()).message ?? "").trim();
  } catch {}
  if (!message) return NextResponse.json({ error: "Type an instruction for the agent." }, { status: 400 });
  if (message.length > 400) return NextResponse.json({ error: "Keep the instruction under 400 characters." }, { status: 400 });

  try {
    return NextResponse.json(await runAgent(message, llm, requestPayment));
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 240) }, { status: 502 });
  }
}
