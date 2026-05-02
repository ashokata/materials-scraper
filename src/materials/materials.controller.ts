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
import { BasicAuthGuard } from '../auth/basic-auth.guard';
import { MaterialsService, MaterialSearchParams } from './materials.service';
import { Source } from '@prisma/client';

class SearchMaterialsDto {
  source?: 'HOMEDEPOT' | 'LOWES';
  category?: string;
  brand?: string;
  search?: string;
  minPrice?: string;
  maxPrice?: string;
  page?: string;
  limit?: string;
}

class BulkDeleteDto {
  daysOld?: number;
}

@Controller('api/materials')
@UseGuards(BasicAuthGuard)
export class MaterialsController {
  constructor(private readonly materialsService: MaterialsService) {}

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
}
