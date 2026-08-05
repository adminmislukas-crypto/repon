/**
 * Domain-invariant violations for `identidad` (core-api-identidad spec).
 * Plain `Error`, zero framework imports (core-api-hexagonal-layout:
 * `domain/` MUST NOT import HTTP-framework types) — a ports-in caller
 * (Phase 4b) translates this into an HTTP response, not this file.
 */
export class InvalidProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidProfileError';
  }
}
