/**
 * design.md D-G (Q7): the seam that separates today's no-op push send from
 * a real one tomorrow. `ExpoPushNotificationAdapter` depends on this port,
 * not on a concrete token store, precisely because no push-token storage
 * exists anywhere in the schema yet (D10) — swapping `NullPushTokenResolver`
 * for a real `KyselyPushTokenResolver` the day the table exists is a
 * ONE-LINE change in `NotificationsModule`, never a change to the adapter.
 */
export interface PushTokenResolver {
  /** `null` = the profile has no registered device. This is NOT an error. */
  resolve(profileId: string): Promise<string | null>;
}

export const PUSH_TOKEN_RESOLVER = Symbol('PUSH_TOKEN_RESOLVER');
