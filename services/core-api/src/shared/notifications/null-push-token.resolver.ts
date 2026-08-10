import { Injectable } from '@nestjs/common';
import type { PushTokenResolver } from './push-token-resolver.port';

/**
 * D10: no push-token table exists in any migration of this repo, and no
 * mobile client (`apps/usuario-mobile/`, `apps/proveedor-mobile/` are still
 * HTML mockups) is capable of registering one. This resolver returns `null`
 * always, on purpose — it is a deliberate, documented stub for a missing
 * capability, not an oversight. Replacing it with a `KyselyPushTokenResolver`
 * the day the table exists is ONE line in `NotificationsModule` (D-G).
 */
@Injectable()
export class NullPushTokenResolver implements PushTokenResolver {
  async resolve(): Promise<null> {
    return null;
  }
}
