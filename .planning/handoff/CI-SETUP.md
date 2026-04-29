# CI setup — required secrets

CI workflows in `.github/workflows/` need a token to fetch the private
sibling dep `distributed-core`. Without it `npm ci` fails on the git URL
during install.

## Required secret

**Name:** `DC_REPO_TOKEN`
**Type:** Repository secret (Settings → Secrets and variables → Actions → New repository secret)
**Value:** A fine-grained Personal Access Token with **read access to `connorhoehn/distributed-core`**

### Creating the PAT

1. https://github.com/settings/personal-access-tokens/new
2. Token name: `dc-read-from-wsg-ci` (or similar)
3. Resource owner: `connorhoehn`
4. Repository access: **Only select repositories** → `connorhoehn/distributed-core`
5. Permissions:
   - Repository permissions → **Contents: Read** (required to clone)
   - Repository permissions → **Metadata: Read** (required, auto-added)
6. Generate token, copy it immediately
7. Paste into the `DC_REPO_TOKEN` secret on `connorhoehn/websocket-gateway`

Set token expiry to 90 days or 1 year. Calendar a renewal.

## Fallback

If `DC_REPO_TOKEN` is unset, the workflows fall back to the auto-injected
`secrets.GITHUB_TOKEN`. That works **only** if the GitHub Actions org/repo
settings allow cross-repo content access — typically false for personal
accounts. If you see `Authentication failed for ...distributed-core.git`
in CI, the fallback isn't sufficient and you must configure
`DC_REPO_TOKEN` per above.

## How CI uses the token

Every workflow that runs `npm ci` configures git URL rewrites:

```bash
REWRITE="https://x-access-token:${DC_TOKEN}@github.com/"
git config --global --add url."${REWRITE}".insteadOf "ssh://git@github.com/"
git config --global --add url."${REWRITE}".insteadOf "git@github.com:"
git config --global --add url."${REWRITE}".insteadOf "https://github.com/"
git config --global --add url."${REWRITE}".insteadOf "git://github.com/"
```

Four rewrites are needed because npm's `hosted-git-info` normalizes
GitHub URLs to multiple forms internally and may try `ssh://` even when
the spec is `git+https://`. `--add` is essential — without it each call
overwrites the previous one, leaving only the last rule.

## docker-build job

The `social-api/Dockerfile` uses BuildKit `--mount=type=secret,id=gh_token`
to pass the token into `npm ci` inside the build without baking it into
a layer of the final image. CI invokes the build with:

```yaml
env:
  DOCKER_BUILDKIT: '1'
  GH_TOKEN: ${{ secrets.DC_REPO_TOKEN || secrets.GITHUB_TOKEN }}
run: docker build --secret id=gh_token,env=GH_TOKEN -t social-api:test social-api/
```

The gateway `Dockerfile` doesn't need this because `src/package.json`
(what the gateway image installs from) doesn't reference distributed-core.

## Local testing with `act`

For local CI verification with [act](https://github.com/nektos/act):

```bash
brew install act docker
colima start
act -W .github/workflows/ci.yml -j lint-and-typecheck \
  --container-architecture linux/amd64 \
  --container-daemon-socket - \
  -s DC_REPO_TOKEN="<your-PAT-here>"
```

The `--container-daemon-socket -` flag avoids the colima socket-mount issue
that act hits on macOS.

The `docker-build` job can't be fully tested via act because act runs
inside a container and doesn't have docker-in-docker by default. Test
the docker layers directly:

```bash
GH_TOKEN="<your-PAT-here>" \
  docker build --secret id=gh_token,env=GH_TOKEN -t social-api:test social-api/
```
