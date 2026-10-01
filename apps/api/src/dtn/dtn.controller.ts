import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ContactPlanJson } from '@lightlink/core';
import { DtnService } from './dtn.service';

@Controller()
export class DtnController {
  constructor(@Inject(DtnService) private readonly dtn: DtnService) {}

  @Get('health')
  health() {
    return { ok: true, service: 'dtn-demo-api' };
  }

  @Get('plan')
  plan() {
    return this.dtn.getPlan();
  }

  @Get('nodes')
  nodes() {
    return this.dtn.getNodes();
  }

  @Get('contacts')
  contacts() {
    return this.dtn.getContacts();
  }

  @Post('simulate')
  simulate(@Body() body?: Partial<ContactPlanJson>) {
    return this.dtn.simulate(body ?? {});
  }

  @Get('runs')
  listRuns(@Query('limit') limit?: string) {
    const n = limit ? Math.min(200, Math.max(1, Number(limit) || 50)) : 50;
    return this.dtn.listRuns(n);
  }

  @Get('runs/:id')
  async getRun(@Param('id') id: string) {
    const run = await this.dtn.getRun(id);
    if (!run) throw new NotFoundException(`run ${id} not found`);
    return run;
  }
}
