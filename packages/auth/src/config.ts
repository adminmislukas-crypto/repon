/**
 * mobile-auth-login design.md D-6: the package never reads `process.env`
 * itself, so it stays app-agnostic and testable — each app supplies its own
 * `apiBaseUrl` (from its `EXPO_PUBLIC_API_URL`) and `expectedRole` (D-5,
 * UX-only role gate) as plain props/config, not environment lookups.
 */
export interface AuthConfig {
  apiBaseUrl: string;
  expectedRole: 'user' | 'provider';
}
