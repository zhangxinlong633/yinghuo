import { Module } from '@nestjs/common';
import { DtnController } from './dtn.controller';
import { DtnService } from './dtn.service';
import { RunsStore } from './runs.store';

@Module({
  controllers: [DtnController],
  providers: [DtnService, RunsStore],
})
export class DtnModule {}
