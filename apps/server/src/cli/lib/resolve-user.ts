// Resolves the user id for a CLI invocation: an explicit `--user` flag wins;
// otherwise fall back to the REPEL_USER_ID environment variable. An empty
// string (flag or env) counts as absent. With neither, throw — user-scoped
// commands cannot guess the acting user.

export function resolveUserId(flag: string | undefined): string {
  if (flag !== undefined && flag !== '') {
    return flag;
  }
  const env = process.env.REPEL_USER_ID;
  if (env !== undefined && env !== '') {
    return env;
  }
  throw new Error('no user: pass --user <uuid> or set REPEL_USER_ID');
}
