import { Module } from '@nestjs/common';
import { DtnModule } from './dtn/dtn.module';

@Module({
  imports: [DtnModule],
})
export class AppModule {}
