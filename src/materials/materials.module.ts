import { Module } from '@nestjs/common';
import { MaterialsController } from './materials.controller';
import { MaterialsService } from './materials.service';
import { ScrapflyService } from '../scraper/scrapfly.service';

@Module({
  controllers: [MaterialsController],
  providers: [MaterialsService, ScrapflyService],
  exports: [MaterialsService],
})
export class MaterialsModule {}
