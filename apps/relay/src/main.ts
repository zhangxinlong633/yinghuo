import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { raw, type NextFunction, type Request, type Response } from 'express';
import { AppModule } from './app.module';
import { loadBpCodec } from './bp/bp-codec';
import { loadRelayConfig } from './config';

/** Nest's JSON parser skips non-JSON. Capture CBOR before the route handler. */
function peerIngestCbor(req: Request, res: Response, next: NextFunction): void {
  const ct = String(req.headers['content-type'] ?? '').toLowerCase();
  if (req.method === 'POST' && ct.includes('application/cbor')) {
    raw({ type: () => true, limit: '2mb' })(req, res, next);
    return;
  }
  next();
}

async function bootstrap(): Promise<void> {
  loadBpCodec();
  const cfg = loadRelayConfig();
  const app = await NestFactory.create(AppModule);
  app.use('/api/peer/ingest', peerIngestCbor);
  app.enableCors({ origin: true });
  app.setGlobalPrefix('api', {
    exclude: [
      { path: '', method: RequestMethod.GET },
      { path: 'console', method: RequestMethod.GET },
    ],
  });
  await app.listen(cfg.port);
  console.log(
    `DTN Relay daemon [${cfg.nodeId}] http://localhost:${cfg.port}/  peer=${cfg.peerUrl}`
  );
  console.log(`  dataDir=${cfg.dataDir}`);
  console.log(`  plan=${cfg.planPath}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
