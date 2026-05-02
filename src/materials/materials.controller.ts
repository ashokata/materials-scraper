import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { IsString, IsNumber, IsOptional, IsEnum, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BasicAuthGuard } from '../auth/basic-auth.guard';
import { MaterialsService, MaterialSearchParams } from './materials.service';
import { ScrapflyService, ScrapedProduct } from '../scraper/scrapfly.service';
import { Source } from '@prisma/client';

class SearchMaterialsDto {
  @IsOptional()
  @IsString()
  source?: 'HOMEDEPOT' | 'LOWES';

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  minPrice?: string;

  @IsOptional()
  @IsString()
  maxPrice?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

class BulkDeleteDto {
  @IsOptional()
  @IsNumber()
  daysOld?: number;
}

class CreateMaterialDto {
  @IsString()
  sku: string;

  @IsEnum(['HOMEDEPOT', 'LOWES'])
  source: 'HOMEDEPOT' | 'LOWES';

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  subcategory?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  price: number;

  @IsOptional()
  @IsNumber()
  originalPrice?: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsString()
  productUrl: string;

  @IsOptional()
  specifications?: Record<string, string>;

  @IsOptional()
  @IsString()
  availability?: string;

  @IsOptional()
  @IsNumber()
  rating?: number;

  @IsOptional()
  @IsNumber()
  reviewCount?: number;
}

class BulkCreateMaterialsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateMaterialDto)
  materials: CreateMaterialDto[];
}

class OnDemandSearchDto {
  @IsString()
  search: string;

  @IsOptional()
  @IsEnum(['HOMEDEPOT', 'LOWES', 'BOTH'])
  source?: 'HOMEDEPOT' | 'LOWES' | 'BOTH';

  @IsOptional()
  @IsString()
  category?: string;
}

@Controller('api/materials')
@UseGuards(BasicAuthGuard)
export class MaterialsController {
  constructor(
    private readonly materialsService: MaterialsService,
    private readonly scrapflyService: ScrapflyService,
  ) {}

  @Get()
  async getMaterials(@Query() query: SearchMaterialsDto) {
    const params: MaterialSearchParams = {
      source: query.source as Source | undefined,
      category: query.category,
      brand: query.brand,
      search: query.search,
      minPrice: query.minPrice ? parseFloat(query.minPrice) : undefined,
      maxPrice: query.maxPrice ? parseFloat(query.maxPrice) : undefined,
      page: query.page ? parseInt(query.page, 10) : 1,
      limit: query.limit ? parseInt(query.limit, 10) : 24,
    };

    return this.materialsService.getMaterials(params);
  }

  @Get('stats')
  async getStats() {
    return this.materialsService.getStats();
  }

  @Get('categories')
  async getCategories(@Query('source') source?: 'HOMEDEPOT' | 'LOWES') {
    return this.materialsService.getCategories(source as Source | undefined);
  }

  @Get('brands')
  async getBrands(
    @Query('source') source?: 'HOMEDEPOT' | 'LOWES',
    @Query('category') category?: string,
  ) {
    return this.materialsService.getBrands(source as Source | undefined, category);
  }

  @Get('sku/:sku')
  async getMaterialBySku(
    @Param('sku') sku: string,
    @Query('source') source?: 'HOMEDEPOT' | 'LOWES',
  ) {
    return this.materialsService.getMaterialBySku(sku, source as Source | undefined);
  }

  @Get('scrape-usage')
  async getScrapflyUsage() {
    return this.scrapflyService.getUsageStats();
  }

  @Get(':id')
  async getMaterial(@Param('id') id: string) {
    return this.materialsService.getMaterialById(id);
  }

  @Get(':id/price-history')
  async getPriceHistory(
    @Param('id') id: string,
    @Query('days') days?: string,
  ) {
    return this.materialsService.getPriceHistory(id, days ? parseInt(days, 10) : 30);
  }

  @Delete(':id')
  @HttpCode(204)
  async deleteMaterial(@Param('id') id: string) {
    await this.materialsService.deleteMaterial(id);
  }

  @Post('cleanup')
  async cleanupOldMaterials(@Body() body: BulkDeleteDto) {
    return this.materialsService.deleteOldMaterials(body.daysOld || 90);
  }

  @Post()
  async createMaterial(@Body() body: CreateMaterialDto) {
    return this.materialsService.upsertMaterial(
      body.source as Source,
      {
        sku: body.sku,
        name: body.name,
        brand: body.brand || '',
        price: body.price,
        originalPrice: body.originalPrice,
        url: body.productUrl,
        image: body.imageUrl || '',
        availability: body.availability || 'Check store',
        rating: body.rating,
        reviewCount: body.reviewCount,
      },
      body.category,
      body.subcategory,
    );
  }

  @Post('bulk')
  async bulkCreateMaterials(@Body() body: BulkCreateMaterialsDto) {
    const results = { success: 0, failed: 0, errors: [] as string[] };

    for (const material of body.materials) {
      try {
        await this.materialsService.upsertMaterial(
          material.source as Source,
          {
            sku: material.sku,
            name: material.name,
            brand: material.brand || '',
            price: material.price,
            originalPrice: material.originalPrice,
            url: material.productUrl,
            image: material.imageUrl || '',
            availability: material.availability || 'Check store',
            rating: material.rating,
            reviewCount: material.reviewCount,
          },
          material.category,
          material.subcategory,
        );
        results.success++;
      } catch (e) {
        results.failed++;
        results.errors.push(`${material.sku}: ${e}`);
      }
    }

    return results;
  }

  @Post('scrape')
  async scrapeOnDemand(@Body() body: OnDemandSearchDto) {
    const { search, source = 'HOMEDEPOT', category = 'General' } = body;

    const scrapedProducts: ScrapedProduct[] = [];
    const savedProducts: any[] = [];
    let scrapeCount = 0;

    try {
      if (source === 'HOMEDEPOT' || source === 'BOTH') {
        const hdProducts = await this.scrapflyService.scrapeHomeDepot(search);
        scrapedProducts.push(...hdProducts);
        scrapeCount++;
      }

      if (source === 'LOWES' || source === 'BOTH') {
        const lowesProducts = await this.scrapflyService.scrapeLowes(search);
        scrapedProducts.push(...lowesProducts);
        scrapeCount++;
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Scrape failed',
        materials: [],
        usage: this.scrapflyService.getUsageStats(),
      };
    }

    // Save scraped products to database
    for (const product of scrapedProducts) {
      if (product.price > 0) {
        try {
          const saved = await this.materialsService.upsertMaterial(
            product.source as Source,
            {
              sku: product.sku,
              name: product.name,
              brand: product.brand,
              price: product.price,
              url: product.url,
              image: product.image,
              availability: 'Check store',
              rating: product.rating,
            },
            category,
          );
          savedProducts.push(saved);
        } catch (e) {
          // Skip duplicates or errors
        }
      }
    }

    return {
      success: true,
      materials: savedProducts,
      total: savedProducts.length,
      cost: `$${(scrapeCount * 0.001).toFixed(3)}`,
      usage: this.scrapflyService.getUsageStats(),
    };
  }
}
