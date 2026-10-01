import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BundleService } from '../bundle/bundle.service';
import type { RelayBundle } from '../bundle/bundle.types';
import { ContactService } from '../contact/contact.service';

@Controller()
export class RelayController {
  constructor(
    @Inject(BundleService) private readonly bundles: BundleService,
    @Inject(ContactService) private readonly contacts: ContactService
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
    return this.contacts.getState();
  }

  @Post('send')
  async send(
    @Body() body: { dst: string; payload: string; ttlMs?: number }
  ) {
    if (!body?.dst || body.payload == null) {
      return { ok: false, error: 'dst and payload required' };
    }
    const bundle = await this.bundles.send(body.dst, String(body.payload), body.ttlMs);
    return { ok: true, bundle };
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
    if (!this.contacts.isOpen() && force !== '1') {
      throw new ServiceUnavailableException({
        accepted: false,
        delivered: false,
        event: 'CONTACT_CLOSED',
        msg: 'contact window closed — peer should store-and-forward later',
      });
    }
    return this.bundles.ingestFromPeer(body.bundle, body.from);
  }

  @Post('peer/ack')
  async peerAck(@Body() body: { bundleId: string; from: string }) {
    if (!body?.bundleId || !body?.from) {
      return { ok: false };
    }
    await this.bundles.onAck(body.bundleId, body.from);
    return { ok: true };
  }
}
