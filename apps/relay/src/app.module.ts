import { Module } from '@nestjs/common';
import { getOrLoadRelayConfig } from './config';
import { RELAY_CONFIG } from './relay.tokens';
import { RelayModule } from './relay/relay.module';

const configProvider = {
  provide: RELAY_CONFIG,
  useFactory: () => getOrLoadRelayConfig(),
};

@Module({
  imports: [RelayModule],
  providers: [configProvider],
  exports: [configProvider],
})
export class AppModule {}
