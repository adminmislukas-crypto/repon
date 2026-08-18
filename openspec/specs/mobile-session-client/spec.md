# mobile-session-client Specification

## Purpose

`@repon/auth` (D4): the client contract shared by `usuario-mobile`/`proveedor-mobile` for secure token persistence, session lifecycle (rehydrate/refresh/logout), the role gate, and auth-aware navigation. Internal module boundaries, storage calls, and refresh-on-401 mechanics are `sdd-design`'s job — this spec fixes only observable client behavior. Out of scope: password reset, email verification, in-app signup screens (D5).

## Requirements

### Requirement: A session survives an app restart

Once login succeeds, the session MUST remain usable across an app restart (process kill + relaunch) without re-entering credentials, until explicit logout or an unrefreshable token expiry.

#### Scenario: Restarting the app keeps the user signed in

- GIVEN a successful login on `usuario-mobile`
- WHEN the app process is killed and relaunched
- THEN the user lands in the authenticated user flow, not the login screen

#### Scenario: Provider session survives restart the same way

- GIVEN a successful login on `proveedor-mobile`
- WHEN the app process is killed and relaunched
- THEN the provider lands in the authenticated provider flow, not the login screen

### Requirement: Logout clears all secure storage

Logout MUST remove every persisted token from `expo-secure-store` and return the app to the login screen; a subsequent relaunch MUST NOT restore the cleared session.

#### Scenario: Logout then relaunch shows the login screen

- GIVEN a signed-in session
- WHEN the user logs out, then the app is relaunched
- THEN the login screen is shown — no token from the prior session is honored

### Requirement: The client enforces its own expected role and discards mismatched sessions

Each app instantiates the shared client with its own `expectedRole` (`'user'` for `usuario-mobile`, `'provider'` for `proveedor-mobile`). When the login response's `role` does not equal `expectedRole` (including `'admin'`, matching neither), the client MUST NOT persist any token, MUST NOT establish a session, and MUST surface the explicit mismatch message before returning to the login screen.

#### Scenario: A mismatched role never reaches secure storage

- GIVEN a login response with `role='user'` on the `proveedor-mobile` client (`expectedRole='provider'`)
- WHEN the client processes the response
- THEN `expo-secure-store` is never written and the user remains on the login screen with the mismatch message

### Requirement: A pending company renders a gated in-app state, not a login refusal

When a provider's login response carries `companyStatus: 'pendiente'`, the client MUST still establish the session (per `core-api-sesion`'s pending-company success rule) and MUST route the provider to a pending-approval state rather than the full provider flow.

#### Scenario: A pending provider sees a pending-approval screen, not the full app

- GIVEN a successful login with `companyStatus: 'pendiente'`
- WHEN the provider reaches the post-login route
- THEN they see a pending-approval state, not the ordinary provider flow

### Requirement: Explicit failures are surfaced verbatim; ambiguous ones are not invented

The client MUST surface `core-api-sesion`'s distinguishable failure messages as-is (suspended account, role mismatch, rate-limited, 503 outage) and MUST NOT collapse them into a generic "invalid credentials" message; it MUST NOT attempt to further distinguish invalid-credentials responses beyond what the server returns.

#### Scenario: A 503 outage is shown distinctly from a wrong-password message

- GIVEN the server returns 503
- WHEN the client renders the error
- THEN the message is visibly different from the wrong-password/unknown-email message

#### Scenario: A rate-limited response is shown distinctly, not as invalid credentials

- GIVEN the server returns 429
- WHEN the client renders the error
- THEN the message names throttling, not "invalid credentials"
