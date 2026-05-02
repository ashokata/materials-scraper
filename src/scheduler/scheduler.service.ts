import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ScraperService } from '../scraper/scraper.service';
import { LowesScraperService } from '../scraper/lowes-scraper.service';
import { MaterialsService } from '../materials/materials.service';
import { Source, ScrapeJobStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

interface CategoryConfig {
  source: Source;
  categoryId: string;
  categoryName: string;
  searchTerms: string[];
}

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);
  private isRunning = false;

  // Field service focused categories
  private readonly categories: CategoryConfig[] = [
    // Electrical
    { source: 'HOMEDEPOT', categoryId: 'electrical-outlets', categoryName: 'Electrical Outlets', searchTerms: ['electrical outlet', 'GFCI outlet', 'USB outlet'] },
    { source: 'HOMEDEPOT', categoryId: 'electrical-switches', categoryName: 'Electrical Switches', searchTerms: ['light switch', 'dimmer switch', 'smart switch'] },
    { source: 'HOMEDEPOT', categoryId: 'electrical-wire', categoryName: 'Electrical Wire', searchTerms: ['romex wire', 'electrical wire 14 gauge', 'wire 12 gauge'] },
    { source: 'HOMEDEPOT', categoryId: 'circuit-breakers', categoryName: 'Circuit Breakers', searchTerms: ['circuit breaker', 'GFCI breaker', 'AFCI breaker'] },

    // Plumbing
    { source: 'HOMEDEPOT', categoryId: 'plumbing-faucets', categoryName: 'Faucets', searchTerms: ['kitchen faucet', 'bathroom faucet', 'utility faucet'] },
    { source: 'HOMEDEPOT', categoryId: 'plumbing-pipes', categoryName: 'Pipes & Fittings', searchTerms: ['PVC pipe', 'copper pipe', 'PEX pipe'] },
    { source: 'HOMEDEPOT', categoryId: 'water-heaters', categoryName: 'Water Heaters', searchTerms: ['water heater', 'tankless water heater', 'water heater element'] },
    { source: 'HOMEDEPOT', categoryId: 'toilets', categoryName: 'Toilets', searchTerms: ['toilet', 'toilet repair kit', 'toilet flapper'] },

    // HVAC
    { source: 'HOMEDEPOT', categoryId: 'hvac-filters', categoryName: 'HVAC Filters', searchTerms: ['HVAC filter', 'furnace filter', 'air filter 20x20'] },
    { source: 'HOMEDEPOT', categoryId: 'thermostats', categoryName: 'Thermostats', searchTerms: ['thermostat', 'smart thermostat', 'programmable thermostat'] },

    // Hardware
    { source: 'HOMEDEPOT', categoryId: 'fasteners', categoryName: 'Fasteners', searchTerms: ['wood screws', 'drywall screws', 'deck screws'] },
    { source: 'HOMEDEPOT', categoryId: 'door-hardware', categoryName: 'Door Hardware', searchTerms: ['door knob', 'door lock', 'deadbolt'] },

    // Lowes categories
    { source: 'LOWES', categoryId: 'electrical-outlets', categoryName: 'Electrical Outlets', searchTerms: ['electrical outlet', 'GFCI outlet'] },
    { source: 'LOWES', categoryId: 'plumbing-faucets', categoryName: 'Faucets', searchTerms: ['kitchen faucet', 'bathroom faucet'] },
    { source: 'LOWES', categoryId: 'hvac-filters', categoryName: 'HVAC Filters', searchTerms: ['HVAC filter', 'furnace filter'] },
  ];

  constructor(
    private prisma: PrismaService,
    private scraperService: ScraperService,
    private lowesScraperService: LowesScraperService,
    private materialsService: MaterialsService,
    private configService: ConfigService,
  ) {}

  async onModuleInit() {
    // Initialize categories in DB
    for (const cat of this.categories) {
      await this.prisma.scrapedCategory.upsert({
        where: {
          source_categoryId: {
            source: cat.source,
            categoryId: cat.categoryId,
          },
        },
        update: {
          categoryName: cat.categoryName,
        },
        create: {
          source: cat.source,
          categoryId: cat.categoryId,
          categoryName: cat.categoryName,
          categoryUrl: '', // Will be populated during scrape
          isActive: true,
        },
      });
    }
    this.logger.log(`Initialized ${this.categories.length} categories`);
  }

  // Run every night at 2 AM
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async runNightlyScrape() {
    if (this.isRunning) {
      this.logger.warn('Scrape job already running, skipping...');
      return;
    }

    this.logger.log('Starting nightly scrape job...');
    await this.runFullScrape();
  }

  // Manual trigger
  async runFullScrape() {
    if (this.isRunning) {
      throw new Error('Scrape job already running');
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      for (const category of this.categories) {
        await this.scrapeCategory(category);
        // Rate limiting - wait between categories
        await this.delay(5000);
      }

      const duration = Math.round((Date.now() - startTime) / 1000);
      this.logger.log(`Full scrape completed in ${duration}s`);
    } catch (error) {
      this.logger.error(`Full scrape failed: ${error}`);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  async scrapeCategory(category: CategoryConfig) {
    const job = await this.prisma.scrapeJob.create({
      data: {
        source: category.source,
        category: category.categoryName,
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });

    let totalScraped = 0;

    try {
      for (const term of category.searchTerms) {
        this.logger.log(`Scraping ${category.source} for: ${term}`);

        // Scrape first 3 pages (72 products) per search term
        for (let page = 1; page <= 3; page++) {
          const result = category.source === 'HOMEDEPOT'
            ? await this.scraperService.searchProducts(term, page)
            : await this.lowesScraperService.searchProducts(term, page);

          if (result.products.length === 0) break;

          // Save to database
          const saveResult = await this.materialsService.bulkUpsertMaterials(
            category.source,
            result.products,
            category.categoryName,
          );

          totalScraped += saveResult.success;

          // Rate limiting between pages
          await this.delay(2000);

          // Stop if we've reached the end
          if (result.products.length < 24) break;
        }

        // Rate limiting between search terms
        await this.delay(3000);
      }

      await this.prisma.scrapeJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          itemsScraped: totalScraped,
          completedAt: new Date(),
        },
      });

      this.logger.log(`Category ${category.categoryName} completed: ${totalScraped} items`);
    } catch (error) {
      await this.prisma.scrapeJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          itemsScraped: totalScraped,
          errorMessage: String(error),
          completedAt: new Date(),
        },
      });

      this.logger.error(`Category ${category.categoryName} failed: ${error}`);
    }

    return totalScraped;
  }

  async scrapeSingleQuery(source: Source, query: string, pages: number = 3) {
    const job = await this.prisma.scrapeJob.create({
      data: {
        source,
        query,
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });

    let totalScraped = 0;

    try {
      for (let page = 1; page <= pages; page++) {
        const result = source === 'HOMEDEPOT'
          ? await this.scraperService.searchProducts(query, page)
          : await this.lowesScraperService.searchProducts(query, page);

        if (result.products.length === 0) break;

        const saveResult = await this.materialsService.bulkUpsertMaterials(
          source,
          result.products,
        );

        totalScraped += saveResult.success;

        if (result.products.length < 24) break;
        await this.delay(2000);
      }

      await this.prisma.scrapeJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          itemsScraped: totalScraped,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      await this.prisma.scrapeJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          itemsScraped: totalScraped,
          errorMessage: String(error),
          completedAt: new Date(),
        },
      });
      throw error;
    }

    return { jobId: job.id, itemsScraped: totalScraped };
  }

  async getJobStatus(jobId: string) {
    return this.prisma.scrapeJob.findUnique({ where: { id: jobId } });
  }

  async getRecentJobs(limit: number = 20) {
    return this.prisma.scrapeJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getRunningJobs() {
    return this.prisma.scrapeJob.findMany({
      where: { status: 'RUNNING' },
    });
  }

  isJobRunning() {
    return this.isRunning;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
