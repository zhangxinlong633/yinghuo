import { Module } from '@nestjs/common';
import { loadRelayConfig } from './config';
import { RELAY_CONFIG } from './relay.tokens';
import { RelayModule } from './relay/relay.module';

const configProvider = {
  provide: RELAY_CONFIG,
  useFactory: () => loadRelayConfig(),
};

@Module({
  imports: [RelayModule],
  providers: [configProvider],
  exports: [configProvider],
})
export class AppModule {}
