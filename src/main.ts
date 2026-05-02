import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable validation
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Enable CORS for FSM app integration
  app.enableCors({
    origin: true,
    credentials: true,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port') || 3000;

  await app.listen(port);
  console.log(`🏠 Home Depot Scraper API running on http://localhost:${port}`);
  console.log(`📚 Endpoints:`);
  console.log(`   GET  /api/products/search?q=<query>&page=<num>`);
  console.log(`   POST /api/products/details { "url": "<product_url>" }`);
  console.log(`   POST /api/products/category { "url": "<category_url>", "page": <num> }`);
  console.log(`   POST /api/products/availability { "sku": "<sku>", "zipCode": "<zip>" }`);
  console.log(`   POST /api/products/cache/clear`);
  console.log(`\n🔐 Basic Auth required (username: ${configService.get('auth.username')})`);
}
bootstrap();
