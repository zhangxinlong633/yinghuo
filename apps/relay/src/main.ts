import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadBpCodec } from './bp/bp-codec';
import { loadRelayConfig } from './config';

async function bootstrap(): Promise<void> {
  loadBpCodec();
  const cfg = loadRelayConfig();
  const app = await NestFactory.create(AppModule);
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
