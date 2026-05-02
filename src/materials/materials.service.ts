import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Source, Prisma } from '@prisma/client';
import { ProductDetails, ProductSummary } from '../scraper/scraper.service';

export interface MaterialSearchParams {
  source?: Source;
  category?: string;
  brand?: string;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  page?: number;
  limit?: number;
}

@Injectable()
export class MaterialsService {
  private readonly logger = new Logger(MaterialsService.name);

  constructor(private prisma: PrismaService) {}

  async upsertMaterial(
    source: Source,
    product: ProductDetails | ProductSummary,
    category?: string,
    subcategory?: string,
  ) {
    const isDetailed = 'description' in product;

    try {
      const material = await this.prisma.material.upsert({
        where: {
          sku_source: {
            sku: product.sku,
            source,
          },
        },
        update: {
          name: product.name,
          brand: product.brand || null,
          category: category || null,
          subcategory: subcategory || null,
          description: isDetailed ? (product as ProductDetails).description : undefined,
          price: product.price,
          originalPrice: product.originalPrice || null,
          imageUrl: isDetailed
            ? (product as ProductDetails).images?.[0]
            : (product as ProductSummary).image || null,
          productUrl: product.url,
          specifications: isDetailed ? (product as ProductDetails).specifications : undefined,
          availability: product.availability || null,
          rating: product.rating || null,
          reviewCount: product.reviewCount || null,
          lastScrapedAt: new Date(),
        },
        create: {
          sku: product.sku,
          source,
          name: product.name,
          brand: product.brand || null,
          category: category || null,
          subcategory: subcategory || null,
          description: isDetailed ? (product as ProductDetails).description : null,
          price: product.price,
          originalPrice: product.originalPrice || null,
          imageUrl: isDetailed
            ? (product as ProductDetails).images?.[0]
            : (product as ProductSummary).image || null,
          productUrl: product.url,
          specifications: isDetailed ? (product as ProductDetails).specifications : Prisma.JsonNull,
          availability: product.availability || null,
          rating: product.rating || null,
          reviewCount: product.reviewCount || null,
        },
      });

      // Record price history if price changed
      const existingHistory = await this.prisma.priceHistory.findFirst({
        where: { materialId: material.id },
        orderBy: { scrapedAt: 'desc' },
      });

      if (!existingHistory || existingHistory.price !== product.price) {
        await this.prisma.priceHistory.create({
          data: {
            materialId: material.id,
            price: product.price,
          },
        });
      }

      return material;
    } catch (error) {
      this.logger.error(`Failed to upsert material ${product.sku}: ${error}`);
      throw error;
    }
  }

  async bulkUpsertMaterials(
    source: Source,
    products: ProductSummary[],
    category?: string,
    subcategory?: string,
  ) {
    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const product of products) {
      try {
        await this.upsertMaterial(source, product, category, subcategory);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push(`${product.sku}: ${error}`);
      }
    }

    this.logger.log(`Bulk upsert: ${results.success} success, ${results.failed} failed`);
    return results;
  }

  async getMaterials(params: MaterialSearchParams) {
    const {
      source,
      category,
      brand,
      search,
      minPrice,
      maxPrice,
      page = 1,
      limit = 24,
    } = params;

    const where: Prisma.MaterialWhereInput = {};

    if (source) where.source = source;
    if (category) where.category = { contains: category, mode: 'insensitive' };
    if (brand) where.brand = { contains: brand, mode: 'insensitive' };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};
      if (minPrice !== undefined) where.price.gte = minPrice;
      if (maxPrice !== undefined) where.price.lte = maxPrice;
    }

    const [materials, total] = await Promise.all([
      this.prisma.material.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.material.count({ where }),
    ]);

    return {
      materials,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getMaterialBySku(sku: string, source?: Source) {
    const where: Prisma.MaterialWhereInput = { sku };
    if (source) where.source = source;

    return this.prisma.material.findFirst({
      where,
      include: {
        priceHistory: {
          orderBy: { scrapedAt: 'desc' },
          take: 30,
        },
      },
    });
  }

  async getMaterialById(id: string) {
    return this.prisma.material.findUnique({
      where: { id },
      include: {
        priceHistory: {
          orderBy: { scrapedAt: 'desc' },
          take: 30,
        },
      },
    });
  }

  async getPriceHistory(materialId: string, days: number = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    return this.prisma.priceHistory.findMany({
      where: {
        materialId,
        scrapedAt: { gte: since },
      },
      orderBy: { scrapedAt: 'asc' },
    });
  }

  async getCategories(source?: Source) {
    const where: Prisma.MaterialWhereInput = {};
    if (source) where.source = source;

    const categories = await this.prisma.material.groupBy({
      by: ['category'],
      where: {
        ...where,
        category: { not: null },
      },
      _count: { category: true },
    });

    return categories
      .filter(c => c.category)
      .map(c => ({
        category: c.category,
        count: c._count.category,
      }));
  }

  async getBrands(source?: Source, category?: string) {
    const where: Prisma.MaterialWhereInput = {};
    if (source) where.source = source;
    if (category) where.category = category;

    const brands = await this.prisma.material.groupBy({
      by: ['brand'],
      where: {
        ...where,
        brand: { not: null },
      },
      _count: { brand: true },
    });

    return brands
      .filter(b => b.brand)
      .map(b => ({
        brand: b.brand,
        count: b._count.brand,
      }));
  }

  async getStats() {
    const [
      totalMaterials,
      homeDepotCount,
      lowesCount,
      categoriesCount,
      brandsCount,
      lastUpdate,
    ] = await Promise.all([
      this.prisma.material.count(),
      this.prisma.material.count({ where: { source: 'HOMEDEPOT' } }),
      this.prisma.material.count({ where: { source: 'LOWES' } }),
      this.prisma.material.groupBy({ by: ['category'], where: { category: { not: null } } }).then(r => r.length),
      this.prisma.material.groupBy({ by: ['brand'], where: { brand: { not: null } } }).then(r => r.length),
      this.prisma.material.findFirst({ orderBy: { lastScrapedAt: 'desc' } }),
    ]);

    return {
      totalMaterials,
      bySource: {
        homedepot: homeDepotCount,
        lowes: lowesCount,
      },
      categories: categoriesCount,
      brands: brandsCount,
      lastScrapedAt: lastUpdate?.lastScrapedAt || null,
    };
  }

  async deleteMaterial(id: string) {
    return this.prisma.material.delete({ where: { id } });
  }

  async deleteOldMaterials(daysOld: number = 90) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    const result = await this.prisma.material.deleteMany({
      where: { lastScrapedAt: { lt: cutoff } },
    });

    this.logger.log(`Deleted ${result.count} materials older than ${daysOld} days`);
    return result;
  }
}
