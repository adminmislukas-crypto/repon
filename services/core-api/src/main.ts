import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './shared/auth/global-exception.filter';

async function bootstrap(): Promise<void> {
  // If `ConfigModule.forRoot`'s `validate` (env.schema.ts) throws — a
  // required var is missing/invalid — it does so synchronously while
  // `AppModule`'s dependency graph is being built inside `NestFactory.create`,
  // *before* `app.listen()` ever runs. Verified empirically (not just
  // asserted): Nest's own default `abortOnError` behavior catches that class
  // of startup failure itself — logs it via its own Logger and calls
  // `process.exit(1)` from inside `NestFactory.create`, before this
  // `await` even settles. The `bootstrap().catch()` below is therefore a
  // secondary safety net, not the primary path, for *this* scenario — it
  // still matters for failures after a successful create() (e.g.
  // `app.listen()` failing because the port is taken).
  //
  // `NestExpressApplication`, not the platform-agnostic default (mobile-auth-login
  // design.md D-3): `app.set('trust proxy', ...)` below is Express-specific,
  // needed so `req.ip` reflects the real client behind a load balancer
  // instead of the socket peer — otherwise every request shares one IP and
  // the login rate limiter's per-IP key degrades into one shared bucket.
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  app.set('trust proxy', config.get<number>('TRUST_PROXY_HOPS', 0));

  // mobile-auth-login: both mobile apps call core-api as a browser web
  // target on a different port — without this, the browser's CORS preflight
  // 404s (no route handles OPTIONS) and blocks every request before it ever
  // reaches a controller, invisible to `curl`-based testing since CORS is
  // enforced client-side only.
  app.enableCors({
    origin: config.get<string>('CORS_ALLOWED_ORIGINS', '').split(',').filter(Boolean),
    credentials: true,
  });

  // core-api-bootstrap spec, "Global validation pipe rejects malformed
  // DTOs": whitelist strips unknown properties, forbidNonWhitelisted turns
  // an unknown property into a 400 instead of silently dropping it.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // core-api-auth-guard spec, "A global exception filter emits stable error
  // codes": every thrown exception becomes `{ statusCode, code, message }`,
  // no stack trace or internal detail leaks into the response body.
  app.useGlobalFilters(new GlobalExceptionFilter());

  const nodeEnv = config.get<string>('NODE_ENV', 'development');
  const port = config.get<number>('PORT', 3000);

  // core-api-bootstrap spec, "Swagger is dev-only" (design.md D5): the API
  // surface and DTO shapes are not published in production.
  if (nodeEnv !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('core-api')
        .setDescription(
          'Repón — backend de dominio (monolito modular, arquitectura hexagonal por dominio)',
        )
        .setVersion('0.0.0')
        // Enables Swagger UI's "Authorize" (bearer token) button for routes
        // marked `@ApiBearerAuth()` (PR 8, `IdentidadController` — the first
        // controller with non-@Public() routes). Documentation-only: does
        // not affect `AuthGuard`'s own verification.
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(port);
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`core-api failed to start:\n${message}`);
  process.exit(1);
});
