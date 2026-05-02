import { Module } from '@nestjs/common';
import { ScraperService } from './scraper.service';
import { LowesScraperService } from './lowes-scraper.service';

@Module({
  providers: [ScraperService, LowesScraperService],
  exports: [ScraperService, LowesScraperService],
})
export class ScraperModule {}
