const BASE_MS = 1000;
const FACTOR = 2;
const CAP_MS = 5 * 60 * 1000;

// Exponential backoff with full jitter, capped. `attempts` is the delivery count
// (>= 1). The ceiling is min(CAP, BASE * FACTOR^(attempts-1)); the returned delay
// is uniformly random in [0, ceiling] — full jitter spreads retries so a batch of
// jobs failing together does not stampede on the same schedule.
export function backoffMs(attempts: number): number {
  const ceiling = Math.min(
    CAP_MS,
    BASE_MS * FACTOR ** Math.max(0, attempts - 1)
  );
  return Math.floor(Math.random() * ceiling);
}
