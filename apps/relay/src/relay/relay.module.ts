import { Module } from '@nestjs/common';
import { BundleService } from '../bundle/bundle.service';
import { ContactService } from '../contact/contact.service';
import { ContactPlanReloadService } from '../contact/contact-plan-reload.service';
import { GraphLifecycleService } from '../graph/graph-lifecycle.service';
import { GraphService } from '../graph/graph.service';
import { PeerService } from '../peer/peer.service';
import { LevelStore } from '../store/level-store';
import { RelayController } from './relay.controller';
import { ConsoleController } from '../console/console.controller';
import { getOrLoadRelayConfig } from '../config';
import { RELAY_CONFIG } from '../relay.tokens';

@Module({
  controllers: [RelayController, ConsoleController],
  providers: [
    {
      provide: RELAY_CONFIG,
      useFactory: () => getOrLoadRelayConfig(),
    },
    LevelStore,
    ContactService,
    ContactPlanReloadService,
    GraphService,
    GraphLifecycleService,
    PeerService,
    BundleService,
  ],
})
export class RelayModule {}
