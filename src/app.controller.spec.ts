import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return service info', () => {
      const result = appController.getRoot();
      expect(result.status).toBe('ok');
      expect(result.service).toBe('Materials Scraper API');
    });
  });

  describe('health', () => {
    it('should return ok status', () => {
      const result = appController.healthCheck();
      expect(result.status).toBe('ok');
    });
  });
});
