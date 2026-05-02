import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ScraperModule } from '../scraper/scraper.module';

@Module({
  imports: [ScraperModule],
  controllers: [ProductsController],
})
export class ProductsModule {}
