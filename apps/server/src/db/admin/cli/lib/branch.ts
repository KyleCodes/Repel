import { execFileSync } from 'node:child_process';

export function getCurrentBranch(): string {
  const out = execFileSync('git', ['branch', '--show-current'], {
    encoding: 'utf8',
  });
  const branch = out.trim();
  if (!branch)
    throw new Error(
      'git branch --show-current returned empty (detached HEAD?)'
    );
  return branch;
}

// Extracts an upper-case ticket slug like "REP-38" from a branch such as
// "kylemuldoon15/rep-38-t1-foundation-...". Returns null when no slug is found.
// Matches the first occurrence of a standard ticket pattern: letters, dash, digits.
export function extractTicketSlug(branch: string): string | null {
  const match = branch.match(/[A-Za-z]+-\d+/);
  if (!match) return null;
  return match[0].toUpperCase();
}
