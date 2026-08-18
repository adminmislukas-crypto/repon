import * as SecureStore from 'expo-secure-store';
import type { Sesion } from './session.types';

const STORAGE_KEY = 'repon.session';

/**
 * One key, one JSON blob (mobile-auth-login design.md D-6). A single write
 * is an atomic replacement — token rotation (access + refresh together)
 * can never persist a half-updated pair. Comfortably under SecureStore's
 * ~2 KB Android value warning.
 */
export async function saveSession(sesion: Sesion): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(sesion));
}

/** Returns `null`, never throws, on a missing or corrupted stored value — treated as "no session". */
export async function loadSession(): Promise<Sesion | null> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Sesion;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
}
