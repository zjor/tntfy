import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { LegacyRouteConverter } from '@nestjs/core/router/legacy-route-converter';
import { Logger } from 'nestjs-pino';
import express from 'express';
import { AppModule } from './app.module';

LegacyRouteConverter.printWarning = () => {};

const REQUIRED_ENV = ['DATABASE_URL', 'TELEGRAM_BOT_TOKEN', 'PUBLIC_BASE_URL'] as const;

function assertEnv() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`missing required env: ${missing.join(', ')}`);
    process.exit(1);
  }
}

async function bootstrap() {
  assertEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(
    '/v1/publish',
    express.text({
      type: ['text/plain', 'text/markdown', 'text/html', 'application/x-www-form-urlencoded'],
      limit: '64kb',
    }),
  );
  app.use(
    '/v1/publish',
    express.raw({
      type: ['application/octet-stream', 'image/*', 'audio/*', 'video/*'],
      limit: '50mb',
    }),
  );
  // Body-parser errors throw before NestJS routes run, so a controller-level
  // exception filter cannot catch them. Translate them here to the PRD shape.
  app.use(
    '/v1/publish',
    (err: any, _req: any, res: any, next: any) => {
      if (err?.type === 'entity.too.large' || err?.status === 413) {
        return res.status(413).json({ error: 'payload_too_large' });
      }
      next(err);
    },
  );
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

bootstrap();
