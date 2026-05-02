import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { BasicAuthGuard } from '../auth/basic-auth.guard';
import { ScraperService } from '../scraper/scraper.service';
import {
  SearchQueryDto,
  ProductUrlDto,
  CategoryQueryDto,
  StoreAvailabilityDto,
} from './dto/search-query.dto';

@Controller('api/products')
@UseGuards(BasicAuthGuard)
export class ProductsController {
  private readonly cacheTtl: number;

  constructor(
    private readonly scraperService: ScraperService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private configService: ConfigService,
  ) {
    this.cacheTtl = (this.configService.get<number>('cache.ttl') ?? 3600) * 1000;
  }

  private getCacheKey(prefix: string, ...parts: string[]): string {
    return `${prefix}:${parts.join(':')}`;
  }

  @Get('search')
  async searchProducts(@Query() query: SearchQueryDto) {
    const cacheKey = this.getCacheKey('search', query.q, String(query.page));
    const cached = await this.cacheManager.get(cacheKey);

    if (cached) {
      return { ...(cached as object), fromCache: true };
    }

    const result = await this.scraperService.searchProducts(query.q, query.page);
    await this.cacheManager.set(cacheKey, result, this.cacheTtl);

    return { ...result, fromCache: false };
  }

  @Post('details')
  async getProductDetails(@Body() body: ProductUrlDto) {
    const cacheKey = this.getCacheKey('product', body.url);
    const cached = await this.cacheManager.get(cacheKey);

    if (cached) {
      return { ...(cached as object), fromCache: true };
    }

    const result = await this.scraperService.scrapeProduct(body.url);
    await this.cacheManager.set(cacheKey, result, this.cacheTtl);

    return { ...result, fromCache: false };
  }

  @Post('category')
  async getCategoryProducts(@Body() body: CategoryQueryDto) {
    const cacheKey = this.getCacheKey('category', body.url, String(body.page));
    const cached = await this.cacheManager.get(cacheKey);

    if (cached) {
      return { ...(cached as object), fromCache: true };
    }

    const result = await this.scraperService.scrapeCategory(body.url, body.page);
    await this.cacheManager.set(cacheKey, result, this.cacheTtl);

    return { ...result, fromCache: false };
  }

  @Post('availability')
  async getStoreAvailability(@Body() body: StoreAvailabilityDto) {
    const cacheKey = this.getCacheKey('availability', body.sku, body.zipCode);
    const cached = await this.cacheManager.get(cacheKey);

    if (cached) {
      return { ...(cached as object), fromCache: true };
    }

    const result = await this.scraperService.getStoreAvailability(
      body.sku,
      body.zipCode,
    );
    await this.cacheManager.set(cacheKey, result, this.cacheTtl);

    return { ...result, fromCache: false };
  }

  @Post('cache/clear')
  async clearCache() {
    // Clear all keys by iterating through store
    const store = (this.cacheManager as any).store;
    if (store && typeof store.reset === 'function') {
      await store.reset();
    } else if (store && typeof store.clear === 'function') {
      await store.clear();
    }
    return { message: 'Cache cleared successfully' };
  }
}
