import { Module } from '@nestjs/common';
import { BundleService } from '../bundle/bundle.service';
import { ContactService } from '../contact/contact.service';
import { GraphService } from '../graph/graph.service';
import { PeerService } from '../peer/peer.service';
import { LevelStore } from '../store/level-store';
import { RelayController } from './relay.controller';
import { ConsoleController } from '../console/console.controller';
import { loadRelayConfig } from '../config';
import { RELAY_CONFIG } from '../relay.tokens';

@Module({
  controllers: [RelayController, ConsoleController],
  providers: [
    {
      provide: RELAY_CONFIG,
      useFactory: () => loadRelayConfig(),
    },
    LevelStore,
    ContactService,
    GraphService,
    PeerService,
    BundleService,
  ],
})
export class RelayModule {}
