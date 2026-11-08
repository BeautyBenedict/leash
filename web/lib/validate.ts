export const ACCOUNT_RE = /^[a-z0-9._-]{2,64}$/;

/** Returns an error message, or null if the payment request is well-formed. */
export function validatePayment(to: unknown, amount: unknown): string | null {
  if (typeof to !== "string" || !ACCOUNT_RE.test(to.trim().toLowerCase())) return "Recipient must be a valid NEAR account name.";
  const a = String(amount ?? "").trim();
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(a) || Number(a) <= 0) return "Amount must be a number like 1 or 2.5 (max 999).";
  return null;
}

export function nearToYocto(v: string): string {
  const [w, f = ""] = v.split(".");
  return (BigInt(w || "0") * 10n ** 24n + BigInt((f + "0".repeat(24)).slice(0, 24))).toString();
}
