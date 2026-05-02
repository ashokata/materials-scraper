import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { BasicAuthGuard } from '../auth/basic-auth.guard';
import { SchedulerService } from './scheduler.service';
import { Source } from '@prisma/client';

class TriggerScrapeDto {
  source: 'HOMEDEPOT' | 'LOWES';
  query: string;
  pages?: number;
}

@Controller('api/scrape')
@UseGuards(BasicAuthGuard)
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  @Get('status')
  async getStatus() {
    const [runningJobs, recentJobs] = await Promise.all([
      this.schedulerService.getRunningJobs(),
      this.schedulerService.getRecentJobs(10),
    ]);

    return {
      isRunning: this.schedulerService.isJobRunning(),
      runningJobs,
      recentJobs,
    };
  }

  @Get('jobs')
  async getRecentJobs(@Query('limit') limit?: string) {
    return this.schedulerService.getRecentJobs(limit ? parseInt(limit, 10) : 20);
  }

  @Get('jobs/:id')
  async getJobStatus(@Param('id') id: string) {
    const job = await this.schedulerService.getJobStatus(id);
    if (!job) {
      throw new HttpException('Job not found', HttpStatus.NOT_FOUND);
    }
    return job;
  }

  @Post('trigger')
  async triggerScrape(@Body() body: TriggerScrapeDto) {
    if (this.schedulerService.isJobRunning()) {
      throw new HttpException('A scrape job is already running', HttpStatus.CONFLICT);
    }

    return this.schedulerService.scrapeSingleQuery(
      body.source as Source,
      body.query,
      body.pages || 3,
    );
  }

  @Post('trigger/full')
  async triggerFullScrape() {
    if (this.schedulerService.isJobRunning()) {
      throw new HttpException('A scrape job is already running', HttpStatus.CONFLICT);
    }

    // Run in background
    this.schedulerService.runFullScrape().catch(err => {
      console.error('Full scrape failed:', err);
    });

    return { message: 'Full scrape started in background' };
  }
}
