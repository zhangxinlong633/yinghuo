import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BundleService } from '../bundle/bundle.service';
import type { BundleEvent } from '../bundle/bundle-machine';
import type { RelayBundle } from '../bundle/bundle.types';
import { ContactService } from '../contact/contact.service';
import type { RelayRuntimeConfig } from '../config';
import { RELAY_CONFIG } from '../relay.tokens';

@Controller()
export class RelayController {
  constructor(
    @Inject(BundleService) private readonly bundles: BundleService,
    @Inject(ContactService) private readonly contacts: ContactService,
    @Inject(RELAY_CONFIG) private readonly cfg: RelayRuntimeConfig
  ) {}

  @Get('health')
  health() {
    return { ok: true, service: 'dtn-relay' };
  }

  @Get('status')
  async status() {
    return this.bundles.status();
  }

  @Get('contacts')
  contactsState() {
    return { ...this.contacts.getState(), links: this.contacts.listLinks() };
  }

  @Get('bundles')
  async listBundles() {
    return { ok: true, bundles: await this.bundles.listBundles() };
  }

  @Get('bundles/:id')
  async bundle(@Param('id') id: string) {
    const bundle = await this.bundles.getBundle(id);
    if (!bundle) return { ok: false, error: 'not found' };
    return { ok: true, bundle };
  }

  @Post('send')
  async send(
    @Body() body: { dst: string; payload: string; ttlMs?: number }
  ) {
    if (!body?.dst || body.payload == null) {
      return { ok: false, error: 'dst and payload required' };
    }
    try {
      const bundle = await this.bundles.send(body.dst, String(body.payload), body.ttlMs);
      return { ok: true, bundle };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('role=relay')) {
        return { ok: false, error: message };
      }
      throw err;
    }
  }

  @Get('recv')
  recv(@Query('clear') clear?: string) {
    const doClear = clear !== '0' && clear !== 'false';
    const messages = this.bundles.recv(doClear);
    return { ok: true, messages };
  }

  @Get('inbox')
  inbox() {
    return { ok: true, messages: this.bundles.peekInbox() };
  }

  /**
   * Peer CLA: only accept when contact window is open (schedule-aware store-and-forward).
   * Header x-dtn-bypass-contact is ignored in normal mode (educational lock).
   */
  @Post('peer/ingest')
  async peerIngest(
    @Body() body: { bundle: RelayBundle; from: string },
    @Headers('x-dtn-force') force?: string
  ) {
    if (!body?.bundle || !body?.from) {
      return { accepted: false, delivered: false, event: 'ERROR', msg: 'bundle+from required' };
    }
    if (force !== '1' && !this.ingestContactOpen(body.bundle, body.from)) {
      throw new ServiceUnavailableException({
        accepted: false,
        delivered: false,
        event: 'CONTACT_CLOSED',
        msg: 'contact window closed — peer should store-and-forward later',
      });
    }
    return this.bundles.ingestFromPeer(body.bundle, body.from);
  }

  /**
   * Gate on the arrival contact (`from`), which is the sender's next hop.
   * Do not use the single first-contact `isOpen()`: when this node is the
   * destination, a different closed segment must not 503. A relay likewise
   * stores while its own outgoing hop is still closed.
   */
  private ingestContactOpen(bundle: RelayBundle, from: string): boolean {
    const deliveringLocally = bundle.dst === this.cfg.nodeId;
    if (deliveringLocally) return this.contacts.isOpenTo(from);
    return this.contacts.isOpenTo(from);
  }

  @Post('peer/ack')
  async peerAck(@Body() body: { bundleId: string; from: string; events?: BundleEvent[] }) {
    if (!body?.bundleId || !body?.from) {
      return { ok: false };
    }
    await this.bundles.onAck(body.bundleId, body.from, body.events ?? []);
    return { ok: true };
  }
}
