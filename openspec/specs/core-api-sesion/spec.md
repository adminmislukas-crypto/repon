# core-api-sesion Specification

## Purpose

The session-issuance surface for `usuario-mobile`/`proveedor-mobile`: `POST /identidad/sesion` (login) plus refresh/logout routes, the credential-failure taxonomy, HTTP status mapping, rate-limiting/lockout policy, and the `status`/role rules governing who may obtain a session. Exact route/DTO shapes and the GoTrue call mechanism (Q1/Q2) are `sdd-design`'s job — this spec fixes only observable behavior. Out of scope, unaffected by any requirement below: password reset, email verification, in-app signup (D5).

## Requirements

### Requirement: Login resolves to exactly one of five outcome classes

The login capability MUST resolve every request to exactly one of: (1) success, (2) invalid credentials, (3) suspended account, (4) rate-limited, (5) backend outage. No other outcome MUST be observable to the caller.

#### Scenario: Success returns a session and routing identity

- GIVEN a `role='user'`, `status='activo'` profile with the correct password
- WHEN `POST /identidad/sesion` is called
- THEN the response carries a usable session plus at least `role` and `status`, and for a `role='provider'` profile also `companyId` and `companyStatus`

#### Scenario: Suspended profile is refused, not gated

- GIVEN a profile with `status='suspendido'` and the correct password
- WHEN login is attempted
- THEN the response is refused with an explicit "account suspended" message; no session material is issued

#### Scenario: Suspended company is refused, not gated

- GIVEN a `role='provider'` profile with `status='activo'` whose `companies.status='suspendido'`, correct password
- WHEN login is attempted
- THEN the response is refused with an explicit "company suspended" message; no session material is issued — mirrors `EmpresaSuspendida` already excluding the company from `catalogo`/`refill-matching`

### Requirement: A pending company is allowed to log in

A `role='provider'` profile whose `companies.status='pendiente'` MUST be a SUCCESS outcome, not a refusal — the response MUST include `companyStatus: 'pendiente'` so the client can render a pending-approval state. Refusing login here would leave the provider with no way to check approval status (R6).

#### Scenario: Pending provider logs in successfully

- GIVEN a `role='provider'` profile, `status='activo'`, `companies.status='pendiente'`, correct password
- WHEN login is attempted
- THEN a session is issued and `companyStatus: 'pendiente'` is present in the response

### Requirement: Wrong password and unknown email are indistinguishable

An unknown email and a known email with a wrong password MUST produce the same HTTP status and the same error code/body shape — the caller MUST NOT be able to tell "no such account" from "wrong password" apart. Reuses the existing `AuthProviderDeterministicError(reason: 'invalid_credentials')` — no new failure class.

#### Scenario: Unknown email is indistinguishable from a wrong password

- GIVEN email A does not exist and email B exists but the submitted password is wrong
- WHEN each is submitted to `POST /identidad/sesion`
- THEN both responses are identical in status and body shape

### Requirement: Backend/GoTrue outage maps to 503, never to invalid-credentials

An unreachable identity provider or an ambiguous failure (timeout/5xx — `AuthProviderAmbiguousError`) MUST return HTTP 503 with a distinct error code, never the invalid-credentials response.

#### Scenario: GoTrue timeout returns 503

- GIVEN GoTrue times out during the password grant
- WHEN `POST /identidad/sesion` is called
- THEN the response is 503, distinguishable in body/code from the invalid-credentials response

### Requirement: Repeated failed logins are throttled per-email and per-IP

The system MUST reject with HTTP 429 any attempt whose submitted email has 5 or more failed attempts recorded in the trailing 15 minutes, and independently MUST reject with HTTP 429 any attempt whose source IP has 20 or more failed attempts (any emails combined) in the trailing 15 minutes. Each lockout is a 15-minute sliding window from the most recent qualifying failure — a correct password during an active email lockout MUST still be rejected. The per-email counter MUST increment identically whether or not the email exists, so lockout state MUST NOT itself reveal account existence. A successful login MUST reset that email's counter.

#### Scenario: Sixth failed attempt for one email is throttled

- GIVEN 5 failed attempts for email E within 15 minutes
- WHEN a 6th attempt is submitted for E
- THEN the response is 429, regardless of whether this password would have been correct

#### Scenario: Lockout blocks even the correct password

- GIVEN email E is currently locked out
- WHEN the correct password for E is submitted
- THEN the response is still 429 until the window elapses

#### Scenario: An unknown email locks out the same as a real one

- GIVEN email U corresponds to no account
- WHEN 5 failed attempts for U occur within 15 minutes
- THEN the 6th attempt for U also returns 429, identical in shape to a real locked-out email

#### Scenario: Twenty attempts from one IP across many emails is throttled

- GIVEN one source IP made 20 failed attempts across 20 different emails within 15 minutes
- WHEN a 21st attempt is made from that IP
- THEN the response is 429, independent of any single email's counter

### Requirement: Role-app mismatch is rejected without a partial session

A successful credential verification whose `profiles.role` does not match the app's expected role (`usuario-mobile` expects `'user'`, `proveedor-mobile` expects `'provider'`; `'admin'` matches neither) MUST NOT leave a usable session on that app: the caller MUST see an explicit message naming the mismatch (e.g. "this account is not a provider account"), and any tokens obtained during the attempt MUST be discarded, never persisted. This is a login/session-establishment rule only — it MUST NOT change which `core-api` routes an already-issued token can call; `AuthGuard`/`RolesGuard`/`@Roles` remain the sole authorization boundary, unaffected by this change (R4).

#### Scenario: A user credential is rejected on proveedor-mobile

- GIVEN a `role='user'` profile with the correct password
- WHEN submitted through `proveedor-mobile`
- THEN login is rejected with an explicit role-mismatch message; no session, no retained token

#### Scenario: A provider credential is rejected on usuario-mobile

- GIVEN a `role='provider'` profile with the correct password
- WHEN submitted through `usuario-mobile`
- THEN login is rejected with an explicit role-mismatch message; no session, no retained token

#### Scenario: An admin credential is rejected by both apps

- GIVEN a `role='admin'` profile with the correct password
- WHEN submitted through either app
- THEN login is rejected with an explicit role-mismatch message on both; no session on either
