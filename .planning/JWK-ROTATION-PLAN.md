# JWK Rotation Migration Plan (DC v0.5.4 KeyManager)

**Status:** scoping doc — no code changes
**Date:** 2026-04-28
**Roadmap link:** `DC-INTEGRATION-ROADMAP.md` Phase 2.4
**Recommendation:** **SKIP** (with one caveat — see §7)

---

## 1. Current state

The gateway is a **JWT verifier**, not an issuer. Tokens come from **AWS Cognito**.

- `src/middleware/auth-middleware.js` constructs a `jwks-rsa` client against
  `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}/.well-known/jwks.json`
  with `cache: true`, `cacheMaxAge: JWKS_CACHE_MAX_AGE_MS` (1 h), `rateLimit: true`,
  `jwksRequestsPerMinute: 10`. `src/config/constants.js` lines 161/164.
- `validateToken()` decodes the JWT to read `kid`, fetches the matching public key
  from the JWKS client, then `jwt.verify(token, publicKey, { algorithms: ['RS256'], issuer })`.
- Mounted in `src/server.js` line 72 (`new AuthMiddleware(this.logger)`) and called
  in the HTTP `upgrade` handler at line 473.
- Env vars: `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `SKIP_AUTH` (dev bypass).
- Separate path: `src/signaling-server.js` uses a `JWT_SECRET` HMAC — orthogonal to
  this work, not migrated here.

Cognito rotates JWKs on its own schedule; `jwks-rsa`'s LRU + `cacheMaxAge` already
handles rotation transparently (cache miss → refetch).

## 2. Target state — what would "rotating JWK" mean here?

Two possible shapes:

- **(A) Verifier with rotation tracking.** Replace `jwks-rsa`'s cache with a
  DC-backed cache that pulls JWKs from Cognito and rotates entries. We'd still be
  a *client* of Cognito's JWKS endpoint.
- **(B) Issuer publishing JWKs.** Gateway mints its own tokens and publishes
  `/.well-known/jwks.json` for downstream verifiers, signing with `RotatingKeyManager`.

We are **not (B)** today — the gateway never issues Cognito-shaped tokens, and
replacing Cognito is explicitly out of scope. We are **already (A)**, just with
`jwks-rsa` instead of `KeyManager`.

## 3. Migration surface (if GO)

Files that would change for shape (A):

1. `src/middleware/auth-middleware.js` — replace `jwks-rsa` client with a wrapper
   that fetches JWKs and stores them through DC's KeyManager. **Requires custom code
   that does not exist in `KeyManager` today** (see §4).
2. `src/config/constants.js` — JWKS cache constants would either move or get joined
   by rotation-window settings.
3. `src/server.js` — no shape change at the call site; AuthMiddleware constructor
   would take a KeyManager/Rotating handle.
4. `package.json` (root + `src/package.json`) — drop `jwks-rsa` dependency.
5. `test/authz-interceptor.test.js` — only file in the repo that mocks any auth
   path (`jest.mock('../src/middleware/authz-middleware')`). **Zero existing tests
   mock `auth-middleware.js` or `jwks-rsa` directly** — surface impact is minimal.
6. (No change needed: `src/signaling-server.js` — separate HMAC path.)

## 4. Distributed-core surface in v0.5.4

`KeyManager` (`src/identity/KeyManager.ts`):
- `exportPublicKeyAsJWK()` / `exportPrivateKeyAsJWK()` — exports **its own**
  in-process key as JWK. Does **not** import external JWKs.
- `sign` / `verify` / `signClusterPayload` / `verifyClusterPayload` — symmetric
  cluster-payload flows.
- Encrypt/decrypt, HMAC, certificate pinning.

`RotatingKeyManager` (`src/identity/RotatingKeyManager.ts`):
- `rotate()` retires the current key, generates a fresh pair.
- `getVerificationKeys()` returns current + non-expired previous public keys.
- `verify()` walks current → previous within `gracePeriodMs`.
- All keys are **locally generated** by KeyManager.

**Gap:** the surface is built around *our* keys. There is no `importJWK()`,
no `setVerificationKeys(externalJwks[])`, no JWKS-fetch helper. To verify a
Cognito-issued JWT we would still need `jsonwebtoken` plus a JWK→PEM converter
(or pull `jose`). DC would not be doing the cryptographic work that `jwks-rsa`
does today; we'd just be wrapping it.

**DC ask required for a true integration:** `KeyManager.importPublicKeyFromJWK(jwk)`
plus a verifier-side rotation manager that accepts external JWKs (not just
self-generated keys). This is **not** filed in the roadmap's DC asks list and
the v0.5.4 handoff does not mention it.

## 5. Risks

- **Race conditions.** `jwks-rsa` already handles "issuer rotated, my cache stale"
  via cache-miss refetch. A custom DC wrapper would have to replicate this — net
  new bug surface for zero new behaviour.
- **Cognito coupling.** KeyManager cannot wrap Cognito's JWKS as-is; we'd write
  glue code. The "rotation" primitive in `RotatingKeyManager` is for *signing*
  rotation, not *verification* cache freshness.
- **Test impact.** `Grep jest\.mock.*auth` returned **1 file**
  (`test/authz-interceptor.test.js`, mocks `authz-middleware`, not `auth-middleware`).
  Migration risk on tests is near-zero — but so is the test floor we'd be replacing.

## 6. Effort estimate (if forced to GO)

- DC ask + ship `importPublicKeyFromJWK` + external-key rotation manager: **5–8 days**
  in `distributed-core`, plus review.
- Gateway integration (auth-middleware rewrite, env var plumbing, integration test): **2–3 days**.
- Regression validation against staging Cognito: **1–2 days**.
- **Total: ~2 weeks of cross-repo work to replicate behaviour `jwks-rsa` already gives us for free.**

If the DC ask is skipped and we wrap `KeyManager` only as a passive "key store":
~3 days, but it adds an indirection layer with no behavioural benefit.

## 7. Recommendation: **SKIP**

`KeyManager` / `RotatingKeyManager` are designed for a service that **owns its
signing keys** (cluster gossip, mTLS-style payloads). Our gateway is a
**verifier of an external IdP** (Cognito). The two models do not overlap:

- We don't sign JWTs → JWK *export* is irrelevant.
- We don't control Cognito's rotation cadence → `RotatingKeyManager.rotate()`
  is meaningless for us.
- `jwks-rsa` already does cache + rate-limit + automatic refetch on `kid` miss.

**Caveat — when this flips to GO:** if/when the gateway begins **issuing** its
own short-lived service-to-service JWTs (e.g. for pipeline webhooks signing,
DC-internal RPC tokens, or replacing the `JWT_SECRET` HMAC in
`src/signaling-server.js` with asymmetric signing), `RotatingKeyManager` is
exactly the right tool and we should revisit. That is a **new feature**, not a
migration of the current Cognito path.

**Action for the follow-up agent:** close this Phase 2.4 line item as SKIP in
the roadmap. Reopen if/when an "issue our own JWTs" requirement lands.
