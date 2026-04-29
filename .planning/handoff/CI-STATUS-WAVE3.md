# CI status unknown — gh CLI unavailable

**Timestamp:** 2026-04-28

## Diagnosis

`gh auth status` reports:

```
You are not logged into any GitHub hosts. To log in, run: gh auth login
```

The `gh` CLI is installed but not authenticated against any GitHub host, so we cannot list workflow runs, fetch failing job logs, or determine which workflow(s) are red on `main`.

## What this means

- Cannot run `gh run list` to identify the most recent failing run on `main`.
- Cannot run `gh run view <id> --log-failed` to grab the failed step's log.
- No CI signal is available from this environment.

## Unblock path (for the human / follow-up agent)

1. Authenticate the GitHub CLI:
   ```
   gh auth login
   ```
   Choose `GitHub.com`, then either HTTPS + browser or a PAT with `repo` + `workflow` scopes.
2. Verify with `gh auth status`.
3. Re-run this diagnostic task. Suggested commands:
   ```
   gh run list --limit 5 --json databaseId,name,conclusion,headBranch,event,createdAt --branch main
   gh run view <id> --log-failed 2>&1 | head -200
   ```

## Workflows audited

0 (unable to query CI).

## Passing / Failing workflows on main

Unknown — requires authenticated `gh`.
