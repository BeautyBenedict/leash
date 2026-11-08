// The AI agent loop. The model decides what to pay; the Leash contract decides whether it is allowed.
import { validatePayment } from "./validate";

export const SYSTEM_PROMPT = `You are a payments assistant AI agent for a small business. You hold a wallet that is managed by Leash, a spending-rules contract on NEAR.
You can pay people with the pay tool. Known vendor: beauty-vendor.testnet.
Do what the user asks. Rules about limits, allowlists, scams and approvals are enforced by the contract, not by you, so do not refuse or second-guess a payment yourself. After each payment, report the contract's result honestly in one or two short sentences (Paid, Blocked with the reason, or Waiting for owner approval).
Never invent a result. If you did not call the tool, say so.`;

export const TOOLS = [
  {
    type: "function",
    function: {
      name: "pay",
      description: "Ask the wallet to pay a NEAR account. The wallet's rules decide whether it goes through.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "NEAR account name of the recipient, e.g. beauty-vendor.testnet" },
          amount_near: { type: "string", description: "Amount in NEAR, e.g. 1 or 2.5" },
          memo: { type: "string", description: "Short reason for the payment" },
        },
        required: ["to", "amount_near"],
      },
    },
  },
];

export type ToolCall = { id: string; function: { name: string; arguments: string } };
export type LlmMessage = { content: string | null; tool_calls?: ToolCall[] };
export type LlmFn = (messages: unknown[]) => Promise<LlmMessage>;
export type PayFn = (to: string, amountNear: string, memo: string) => Promise<unknown>;
export type PaymentRecord = { to: string; amount: string; outcome: unknown };

export async function runAgent(message: string, llm: LlmFn, pay: PayFn) {
  const messages: unknown[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: message },
  ];
  const payments: PaymentRecord[] = [];

  for (let step = 0; step < 3; step++) {
    const m = await llm(messages);
    if (!m.tool_calls?.length) return { reply: m.content ?? "", payments };

    messages.push({ role: "assistant", content: m.content ?? null, tool_calls: m.tool_calls });
    for (const call of m.tool_calls) {
      let result: unknown;
      if (call.function.name !== "pay") result = { error: "Unknown tool" };
      else if (payments.length >= 3) result = { error: "Too many payments in one request" };
      else {
        try {
          const args = JSON.parse(call.function.arguments || "{}");
          const to = String(args.to ?? "").trim().toLowerCase();
          const amount = String(args.amount_near ?? "").trim();
          const err = validatePayment(to, amount);
          if (err) result = { error: err };
          else {
            const outcome = await pay(to, amount, String(args.memo ?? "agent payment"));
            payments.push({ to, amount, outcome });
            result = { outcome };
          }
        } catch (e) {
          result = { error: `Payment failed: ${String(e).slice(0, 120)}` };
        }
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return { reply: "The agent stopped after several steps.", payments };
}
