import { getRequiredEnvVar } from '@repel/backend-env/accessors';

// Resolves the user id for a CLI invocation: an explicit `--user` flag wins;
// otherwise fall back to the REPEL_USER_ID environment variable. An empty
// string (flag or env) counts as absent. With neither, throw — user-scoped
// commands cannot guess the acting user.

export function resolveUserId(flag: string | undefined): string {
  if (flag !== undefined && flag !== '') {
    return flag;
  }
  return getRequiredEnvVar(
    'REPEL_USER_ID',
    'no user: pass --user <uuid> or set REPEL_USER_ID'
  );
}
