import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { selectJwtVerifier } from './jwt/jwt-verifier.factory';
import { JWT_VERIFIER, type JwtVerifier } from './jwt/jwt-verifier.port';

/**
 * design.md D-E, "Orden de módulos": exports the guard **classes** and
 * `JWT_VERIFIER` — deliberately does NOT register `APP_GUARD`. `AppModule`
 * does that once it also imports `IdentidadModule` (PR 6), after
 * `ACTOR_PORT` has a real provider; registering the guard here would make
 * `AuthModule` and `IdentidadModule` circularly dependent.
 */
@Global()
@Module({
  providers: [
    {
      provide: JWT_VERIFIER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtVerifier =>
        selectJwtVerifier({
          mode: config.getOrThrow<string>('AUTH_JWT_MODE'),
          issuer: config.getOrThrow<string>('AUTH_JWT_ISSUER'),
          audience: config.getOrThrow<string>('AUTH_JWT_AUDIENCE'),
          hs256Secret: config.get<string>('SUPABASE_JWT_SECRET') ?? '',
          jwksUrl: config.get<string>('SUPABASE_JWKS_URL') ?? '',
        }),
    },
    AuthGuard,
    RolesGuard,
  ],
  exports: [JWT_VERIFIER, AuthGuard, RolesGuard],
})
export class AuthModule {}
