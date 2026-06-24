import { describe, expect, test } from 'bun:test';
import { deriveWorktreeEnv } from '../worktree-env';

describe('deriveWorktreeEnv', function () {
  test('derives ports from the ticket number (REP-69 → 69)', function () {
    const env = deriveWorktreeEnv('kylemuldoon15/rep-69-foundations-grafana');
    expect(env.grafanaPort).toBe(12069);
    expect(env.apiPort).toBe(14069);
    expect(env.pgPort).toBe(16069);
    expect(env.projectName).toBe(
      'repel_kylemuldoon15_rep-69-foundations-grafana'
    );
    expect(env.databaseUrl).toBe('postgres://repel:dev@localhost:16069/repel');
  });

  test('a bare REP-7 branch maps to offset 7', function () {
    const env = deriveWorktreeEnv('REP-7');
    expect(env.pgPort).toBe(16007);
    expect(env.grafanaPort).toBe(12007);
    expect(env.apiPort).toBe(14007);
  });

  test('no-ticket branch gets a stable, in-band hash offset', function () {
    const a = deriveWorktreeEnv('feature/no-ticket-here');
    const b = deriveWorktreeEnv('feature/no-ticket-here');
    expect(a).toEqual(b); // deterministic
    expect(a.pgPort).toBeGreaterThanOrEqual(16001);
    expect(a.pgPort).toBeLessThan(18000);
    expect(a.grafanaPort).toBeGreaterThanOrEqual(12001);
    expect(a.apiPort).toBeGreaterThanOrEqual(14001);
  });

  test('throws on a branch that sanitizes to empty', function () {
    expect(function () {
      deriveWorktreeEnv('---');
    }).toThrow();
  });
});
