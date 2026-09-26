# IYZ-01B: isolated Sandbox payment-result receiver

## State, owner and scope

User direction (26 September 2026): continue iyzico, leave the other agent's MVP work alone. This is an implementer/coordinator candidate, not independent R1 acceptance or a live payment feature.

- Parent: PR #642, `cffd218f633eea00448efff767d877581f18d072`.
- Parent's integration base/main inspected: `6ec6e4fd0aa31bfeedcb797ad56898390db6758e`.
- Branch: `iyz-01b-sandbox-result-receiver`, stacked on `iyz-01a-sandbox-provider-candidate`.
- Scoped claim: [Issue #65 comment 5848081019](https://github.com/ziyabeey/randevu/issues/65#issuecomment-5848081019).
- Size M / FOCUSED: payment-result orchestration; independent risk-based review before integration.
- Only three NEW paths: `worker/iyzico-sandbox-receiver.ts`, `tests/iyzico-sandbox-receiver.test.mjs`, this handoff.

Parent CI #3091, run `36256083615`, attempt 1, job `108443018914` was read from GitHub and is SUCCESS, including all required code checks and cleanup. Parent discussion contained no independent R1 receipt. Parent and child remain draft until canonical task registration, required CI and applicable independent acceptance. [TASKS](../../TASKS.md) remains the only live task/main-acceptance authority; no status is silently changed by this document.

No parent adapter/verifier changes. No `worker/app.ts`, auth/tickets, existing financial functions, migration, package/lockfile, workflow, .dev.vars, staging/deploy, DNS, Netgsm or F17 files change. Local package.json only selects ESM for the isolated test directory; it is NOT a repository change. This factory is not imported or registered by the application.

## Implemented behavior

`createIyzicoSandboxReceiver(env, transport, ports, options)` creates an actual Request -> Response function. Construction/import has no network, environment reads, credential retrieval or database writes.

1. Exact configured HTTPS callback/webhook URLs; POST only. Content type/charset, declared length, actual UTF-8 byte count (16 KiB), encoding and total deadline are bounded. No request query/host chooses the merchant or redirects the user. The callback accepts one form-encoded token only; duplicate, encoded-duplicate and extra fields are rejected. HPP uses JSON and requires the V3 header format before admission.
2. A mandatory injected `admit` port must grant access before body reading, token lookup and provider work. This code does not implement production rate limits. Rejected/unread bodies are canceled without waiting on arbitrary cancellation promises.
3. `findAttempt` receives the configured account reference and the token as a lookup key only. The returned server-side binding is checked for Sandbox/account/token/identifier/amount/revision shape and snapshotted into immutable primitives. Callback/HPP business, ticket, amount and merchant metadata are never accepted as this authority.
4. HPP calls the parent's real V3 verifier. Both HPP and browser callback then call the parent's actual CF Retrieve adapter through explicitly injected transport. Verification includes the signed provider response and the trusted attempt amounts/IDs. HPP payment ID, persisted payment ID when present and Retrieved payment ID must agree.
5. Only a verified successful and fraud-approved Sandbox payment reaches `commitVerifiedPayment`. The port gets the exact attempt revision and immutable verified payment. It must revalidate and atomically commit or return conflict. The HTTP receiver does not open an adisyon, write SQL, adjust balances or use process-memory deduplication.
6. Only a matching `applied` or `already_applied` commit receipt yields 200 `processed`. Error/conflict/pending/timeout returns 503 `unconfirmed`, never `paid` or a claim of rollback. Other rejected requests return generic 4xx `rejected`. Responses contain no token, identity, PII, amount or upstream exception. All responses are no-store/nosniff/no-referrer.
7. Total deadline covers admission/body/lookup/Retrieve/commit. Client abort or deadline prevents subsequent work from reaching commit. An already-started commit may complete late if its implementation ignores cancellation; its outcome is UNKNOWN and must be recovered through the same durable attempt, not by starting a new charge.

## Required ports, NOT delivered implementations

`SandboxReceiverPorts` is a trusted server boundary with `admit`, `findAttempt` and `commitVerifiedPayment`. No permissive default or global fetch fallback exists. Explicit in-memory ports in tests are NOT production adapters.

Before route registration, a bounded shared-file integration must provide:

- Durable tenant/ticket/account/environment-bound payment attempts created by an authorized initialize path, with server-derived basket/amount and protected provider token. Do not derive a trusted attempt from the callback or expose raw token/keys in logs.
- Real abuse/resource limits. Public provider callbacks must not be granted ordinary member/session privileges or weaken existing Origin/CSRF boundaries.
- Transactional commit with stable lock order and uniqueness for provider account + environment + payment ID, plus same-attempt replay. Validate current ticket/attempt/revision, amount, currency and outstanding balance. Ledger write and attempt transition must be atomic; duplicate event delivery must not create a second payment.
- Different attempts that both actually charged money require explicit overpayment/reconciliation/refund handling. Never silently discard a second genuine provider payment, credit it to another ticket, or invent a successful refund.
- Durable reconciliation for missing callbacks, failed notifications, unknown transport/commit results and pending fraud. Returning 503 is NOT a scheduler and does not guarantee eventual delivery. The parent adapter deliberately does not turn all failures into authenticated terminal failure records.
- Bound accountRef to the correct credential selection. A platform API key does not establish merchant entitlement to collect every salon's money; commercial/seller responsibilities remain unresolved integration input.
- Browser result presentation or redirect to an authorized status page. This receiver returns a minimal JSON acknowledgment; no checkout UI, public payment-status endpoint or browser navigation is implemented.

## Actual local evidence

Node `v22.16.0`, on local copies of parent source/tests verified by Git blob SHA:

```sh
node --test --experimental-strip-types tests/iyzico-sandbox-receiver.test.mjs
# 101 PASS / 0 FAIL / 0 SKIP, 25 top-level tests (nested cases included).
node --test --experimental-strip-types tests/iyzico-sandbox*.test.mjs
# 202 PASS / 0 FAIL / 0 SKIP, 59 top-level tests (includes parent's unchanged 101).
tsc --noEmit --strict --noUnusedLocals --noUnusedParameters \
  --allowImportingTsExtensions --target ES2022 --lib ES2023,WebWorker \
  --module ESNext --moduleResolution Bundler worker/iyzico-sandbox*.ts
```

Isolated TypeScript 5.8.3 passed. The first local typecheck exposed `URLSearchParams.keys` unavailable in the configured WebWorker library; the child uses `forEach` without changing tsconfig. This is NOT repository TypeScript 7.0.2 or full app build evidence.

Tests use actual Request/Response streams, actual parent adapter/V3 verifier, real Web Crypto with independent Node HMAC fixtures, and only fabricated credentials. Guarded global fetch calls: 0. Server storage/admission and provider transport are explicit test doubles. The 12 parallel callback/HPP case produces 12 commit calls and one synthetic Map-backed effect, proving delegation only; it is NOT real PostgreSQL concurrency, persisted replay or cross-tenant acceptance.

Other cases cover waiting for commit before acknowledging, invalid bodies, encoded duplicate token, wrong merchant environment, admission rejection, mismatched separately signed payment IDs, amount/fraud/signature failures, expired work, caller mutation, late commit and redacted errors. No existing tests were weakened.

Terminal GitHub DNS resolution failed; the connector supplies current files and publishes the candidate. Full npm install/build/typecheck/SQL/browser/staging and actual iyzico Sandbox are not run locally. Current-candidate automatic CI must be read separately; parent's CI is not child evidence.

## Sources and next step

Read source/context: AGENTS and existing IYZ-01A scope/PR, TASKS/F17 boundaries, Issue #65 latest claims, exact parent modules/tests. No installed iyzico-specific skill is available; no DB/browser skill is claimed. Official sources checked on 26 September 2026:

- [CF Retrieve](https://docs.iyzico.com/en/payment-methods/checkoutform/cf-implementation/cf-retrieve): callback posts token and requires a separate server query. Direct web open failed; official search text supplied this narrow statement.
- [Response signature validation](https://docs.iyzico.com/ek-servisler/imza-yanitinin-dogrulanmasi): CF signed field order and decimal normalization; existing parent contract unchanged.
- [Webhook](https://docs.iyzico.com/ek-servisler/webhook): HPP V3 formula, HTTPS endpoint and limited provider retries until 2xx. The signature feature must be enabled on the merchant account; configured secrets alone do not prove that it is active.

Next: inspect exact child CI and obtain the bounded independent review without a paid routine or self-approval. The active coordinator registers IYZ-01A/IYZ-01B in TASKS and allocates the durable-store/route integration slice separately. Do not import this receiver with fake/permissive ports or count it as a completed live callback, ledger integration, refund or MVP gate.
