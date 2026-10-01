import { Controller, Get, Header, Inject, Redirect } from '@nestjs/common';
import { RELAY_CONFIG } from '../relay.tokens';
import type { RelayRuntimeConfig } from '../config';
import { buildConsoleHtml } from './console.page';

/** Built-in HTML ops UI at GET / — light green / deep green themes. */
@Controller()
export class ConsoleController {
  constructor(@Inject(RELAY_CONFIG) private readonly cfg: RelayRuntimeConfig) {}

  @Get()
  @Header('content-type', 'text/html; charset=utf-8')
  homePage(): string {
    return buildConsoleHtml({
      nodeId: this.cfg.nodeId,
      port: this.cfg.port,
      peerUrl: this.cfg.peerUrl,
    });
  }

  /** Old bookmark → home. */
  @Get('console')
  @Redirect('/', 302)
  consoleAlias(): void {}
}
