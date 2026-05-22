// Resolves the org id for a CLI invocation: an explicit `--org` flag wins;
// otherwise fall back to the REPEL_ORG_ID environment variable. An empty
// string (flag or env) counts as absent. With neither, the command cannot
// scope its transaction — throw rather than guess.

export function resolveOrgId(flag: string | undefined): string {
  if (flag !== undefined && flag !== '') {
    return flag;
  }
  const env = process.env.REPEL_ORG_ID;
  if (env !== undefined && env !== '') {
    return env;
  }
  throw new Error('no org: pass --org <uuid> or set REPEL_ORG_ID');
}
