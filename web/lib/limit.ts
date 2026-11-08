// Tiny in-memory rate limit (per server instance) so a public demo can't drain the vault or the LLM quota.
const hits = new Map<string, number[]>();
let globalHits: number[] = [];

export function limited(ip: string, perMin = 6, perHour = 60): boolean {
  const now = Date.now();
  const mine = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  globalHits = globalHits.filter((t) => now - t < 3_600_000);
  if (mine.length >= perMin || globalHits.length >= perHour) return true;
  mine.push(now);
  globalHits.push(now);
  hits.set(ip, mine);
  return false;
}
