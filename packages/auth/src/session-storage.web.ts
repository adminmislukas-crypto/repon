import type { Sesion } from './session.types';

const STORAGE_KEY = 'repon.session';

/**
 * `localStorage` fallback for the web build (mobile-auth-login design.md
 * D-6) — `expo-secure-store` is a native module and does not work on web,
 * and both apps ship a Metro web target. Metro resolves this `.web.ts`
 * sibling automatically for web bundles; `tsc` typechecks both files
 * independently regardless (see `tsconfig.json`'s `lib` comment). Same
 * one-key/one-blob/atomic-replacement contract as `session-storage.ts`.
 */
export async function saveSession(sesion: Sesion): Promise<void> {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sesion));
}

export async function loadSession(): Promise<Sesion | null> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Sesion;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  localStorage.removeItem(STORAGE_KEY);
}
