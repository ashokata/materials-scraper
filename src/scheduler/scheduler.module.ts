import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { SchedulerController } from './scheduler.controller';
import { ScraperModule } from '../scraper/scraper.module';
import { MaterialsModule } from '../materials/materials.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ScraperModule,
    MaterialsModule,
  ],
  controllers: [SchedulerController],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
