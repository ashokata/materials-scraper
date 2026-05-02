import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getRoot() {
    return {
      status: 'ok',
      service: 'Materials Scraper API',
      version: '1.0.0',
      description: 'Home Depot & Lowes product data scraper for Infieldr pricebook',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('health')
  healthCheck() {
    return { status: 'ok' };
  }

  @Get('api/health')
  apiHealthCheck() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
