import { Injectable, Logger } from '@nestjs/common';

const SCRAPFLY_API_KEY = process.env.SCRAPFLY_API_KEY || 'scp-live-21af792e6f9e44f990bda03eaf8fed78';
const SCRAPFLY_API_URL = 'https://api.scrapfly.io/scrape';

// Usage limits
const DAILY_LIMIT = parseInt(process.env.SCRAPFLY_DAILY_LIMIT || '50', 10);
const HOURLY_LIMIT = parseInt(process.env.SCRAPFLY_HOURLY_LIMIT || '10', 10);

export interface ScrapedProduct {
  sku: string;
  name: string;
  brand: string;
  price: number;
  url: string;
  image: string;
  rating?: number;
  source: 'HOMEDEPOT' | 'LOWES';
}

@Injectable()
export class ScrapflyService {
  private readonly logger = new Logger(ScrapflyService.name);

  // In-memory usage tracking (resets on restart)
  private usageLog: { timestamp: Date; search: string; source: string }[] = [];

  private checkRateLimit(): { allowed: boolean; reason?: string } {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Clean old entries
    this.usageLog = this.usageLog.filter(entry => entry.timestamp > oneDayAgo);

    const hourlyCount = this.usageLog.filter(entry => entry.timestamp > oneHourAgo).length;
    const dailyCount = this.usageLog.length;

    if (hourlyCount >= HOURLY_LIMIT) {
      return { allowed: false, reason: `Hourly limit reached (${HOURLY_LIMIT}/hour)` };
    }
    if (dailyCount >= DAILY_LIMIT) {
      return { allowed: false, reason: `Daily limit reached (${DAILY_LIMIT}/day)` };
    }

    return { allowed: true };
  }

  private logUsage(search: string, source: string) {
    this.usageLog.push({ timestamp: new Date(), search, source });
    this.logger.log(`Scrapfly usage: ${this.usageLog.length}/${DAILY_LIMIT} daily, search="${search}", source=${source}`);
  }

  getUsageStats() {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    this.usageLog = this.usageLog.filter(entry => entry.timestamp > oneDayAgo);

    return {
      hourlyUsed: this.usageLog.filter(entry => entry.timestamp > oneHourAgo).length,
      hourlyLimit: HOURLY_LIMIT,
      dailyUsed: this.usageLog.length,
      dailyLimit: DAILY_LIMIT,
      estimatedCost: `$${(this.usageLog.length * 0.001).toFixed(3)}`,
      recentSearches: this.usageLog.slice(-10).map(e => ({
        search: e.search,
        source: e.source,
        time: e.timestamp
      })),
    };
  }

  async scrapeHomeDepot(searchTerm: string): Promise<ScrapedProduct[]> {
    const rateCheck = this.checkRateLimit();
    if (!rateCheck.allowed) {
      this.logger.warn(`Rate limit: ${rateCheck.reason}`);
      throw new Error(rateCheck.reason);
    }
    this.logUsage(searchTerm, 'HOMEDEPOT');
    const url = `https://www.homedepot.com/s/${encodeURIComponent(searchTerm)}`;
    return this.scrapeUrl(url, 'HOMEDEPOT');
  }

  async scrapeLowes(searchTerm: string): Promise<ScrapedProduct[]> {
    const rateCheck = this.checkRateLimit();
    if (!rateCheck.allowed) {
      this.logger.warn(`Rate limit: ${rateCheck.reason}`);
      throw new Error(rateCheck.reason);
    }
    this.logUsage(searchTerm, 'LOWES');
    const url = `https://www.lowes.com/search?searchTerm=${encodeURIComponent(searchTerm)}`;
    return this.scrapeUrl(url, 'LOWES');
  }

  private async scrapeUrl(url: string, source: 'HOMEDEPOT' | 'LOWES'): Promise<ScrapedProduct[]> {
    try {
      this.logger.log(`Scraping ${source}: ${url}`);

      const params = new URLSearchParams({
        key: SCRAPFLY_API_KEY,
        url: url,
        asp: 'true', // Anti-scraping protection bypass
        render_js: 'true', // JavaScript rendering
        rendering_wait: '3000', // Wait for JS to load
        country: 'us',
      });

      const response = await fetch(`${SCRAPFLY_API_URL}?${params.toString()}`);

      if (!response.ok) {
        this.logger.error(`Scrapfly error: ${response.status} ${response.statusText}`);
        return [];
      }

      const data = await response.json();
      const html = data.result?.content || '';

      if (!html) {
        this.logger.warn('No HTML content returned from Scrapfly');
        return [];
      }

      this.logger.log(`Got ${html.length} bytes of HTML`);

      if (source === 'HOMEDEPOT') {
        return this.parseHomeDepotHtml(html);
      } else {
        return this.parseLowesHtml(html);
      }
    } catch (error) {
      this.logger.error(`Scrapfly scrape failed: ${error}`);
      return [];
    }
  }

  private parseHomeDepotHtml(html: string): ScrapedProduct[] {
    const products: ScrapedProduct[] = [];

    // Extract Apollo state
    const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*({.+?});/s);
    if (!apolloMatch) {
      this.logger.warn('No Apollo state found in Home Depot HTML');
      return this.parseHomeDepotFallback(html);
    }

    try {
      const apolloData = JSON.parse(apolloMatch[1]);

      for (const [key, entry] of Object.entries(apolloData)) {
        if (!key.startsWith('base-searchNav-')) continue;

        const product = entry as any;
        const sku = product.itemId;
        if (!sku || !/^\d+$/.test(sku)) continue;

        const identifiers = product.identifiers || {};
        const name = identifiers.productLabel || '';
        const brand = identifiers.brandName || '';
        const urlPath = identifiers.canonicalUrl || '';

        // Get price
        let price = 0;
        for (const pricingKey of Object.keys(product)) {
          if (pricingKey.startsWith('pricing')) {
            const pricing = product[pricingKey];
            if (pricing && typeof pricing === 'object') {
              price = pricing.value || 0;
            }
            break;
          }
        }

        // Get image
        let image = '';
        const media = product.media || {};
        const images = media.images || [];
        if (images.length > 0 && images[0].url) {
          image = images[0].url.replace('<SIZE>', '400');
        }

        // Get rating
        let rating = 0;
        const reviews = product.reviews || {};
        if (reviews.ratingsReviews) {
          rating = parseFloat(reviews.ratingsReviews.averageRating) || 0;
        }

        if (sku && name && price > 0) {
          products.push({
            sku,
            name: name.substring(0, 200),
            brand: brand.substring(0, 50),
            price,
            url: urlPath ? `https://www.homedepot.com${urlPath}` : '',
            image,
            rating,
            source: 'HOMEDEPOT',
          });
        }
      }
    } catch (error) {
      this.logger.error(`Failed to parse Apollo state: ${error}`);
      return this.parseHomeDepotFallback(html);
    }

    return products.slice(0, 24);
  }

  private parseHomeDepotFallback(html: string): ScrapedProduct[] {
    const products: ScrapedProduct[] = [];
    const seen = new Set<string>();

    // Extract product URLs
    const urlPattern = /href="(\/p\/[^"]+\/(\d{9}))"/g;
    let match;

    while ((match = urlPattern.exec(html)) !== null) {
      const [, urlPath, sku] = match;
      if (seen.has(sku)) continue;
      seen.add(sku);

      // Extract name from URL
      const namePart = urlPath.split('/p/')[1]?.split('/')[0] || '';
      const name = namePart.replace(/-/g, ' ');

      products.push({
        sku,
        name: name.substring(0, 200),
        brand: name.split(' ')[0] || '',
        price: 0,
        url: `https://www.homedepot.com${urlPath}`,
        image: '',
        source: 'HOMEDEPOT',
      });

      if (products.length >= 24) break;
    }

    return products;
  }

  private parseLowesHtml(html: string): ScrapedProduct[] {
    const products: ScrapedProduct[] = [];

    // Try to find JSON state
    const statePatterns = [
      /window\.__PRELOADED_STATE__\s*=\s*({.+?});/s,
      /window\.__APOLLO_STATE__\s*=\s*({.+?});/s,
    ];

    for (const pattern of statePatterns) {
      const match = html.match(pattern);
      if (match) {
        try {
          const data = JSON.parse(match[1]);
          const extracted = this.extractLowesProducts(data);
          if (extracted.length > 0) {
            return extracted;
          }
        } catch {
          continue;
        }
      }
    }

    // Fallback: extract from URLs
    return this.parseLowesFallback(html);
  }

  private extractLowesProducts(data: any, depth = 0): ScrapedProduct[] {
    if (depth > 10) return [];

    const products: ScrapedProduct[] = [];

    if (Array.isArray(data)) {
      for (const item of data) {
        products.push(...this.extractLowesProducts(item, depth + 1));
      }
    } else if (data && typeof data === 'object') {
      if (data.productId || data.modelId) {
        const sku = String(data.productId || data.modelId || data.itemNumber || '');
        const name = data.description || data.productTitle || data.name || '';

        let brand = data.brand || data.brandName || '';
        if (typeof brand === 'object') {
          brand = brand.name || brand.brandName || '';
        }

        let price = 0;
        const pricing = data.pricing || data.price || {};
        if (typeof pricing === 'object') {
          price = pricing.price || pricing.value || pricing.unitPrice || 0;
        } else if (typeof pricing === 'number') {
          price = pricing;
        }

        let url = data.pdURL || data.productUrl || data.url || '';
        if (url && !url.startsWith('http')) {
          url = `https://www.lowes.com${url}`;
        }

        let image = '';
        const images = data.images || data.imageUrls || [];
        if (Array.isArray(images) && images.length > 0) {
          const img = images[0];
          image = typeof img === 'object' ? img.url || '' : img;
        }

        if (sku && name && price > 0) {
          products.push({
            sku,
            name: String(name).substring(0, 200),
            brand: String(brand).substring(0, 50),
            price: Number(price),
            url,
            image,
            source: 'LOWES',
          });
        }
      }

      for (const value of Object.values(data)) {
        if (typeof value === 'object' && value !== null) {
          products.push(...this.extractLowesProducts(value, depth + 1));
        }
      }
    }

    return products.slice(0, 24);
  }

  private parseLowesFallback(html: string): ScrapedProduct[] {
    const products: ScrapedProduct[] = [];
    const seen = new Set<string>();

    const urlPattern = /href="(\/pd\/[^"]+)"/g;
    let match;

    while ((match = urlPattern.exec(html)) !== null) {
      const urlPath = match[1];
      const skuMatch = urlPath.match(/\/(\d{6,})(?:\?|$|#)/);
      if (!skuMatch) continue;

      const sku = skuMatch[1];
      if (seen.has(sku)) continue;
      seen.add(sku);

      const namePart = urlPath.split('/pd/')[1]?.split('/')[0] || '';
      const name = namePart.replace(/-/g, ' ');

      products.push({
        sku,
        name: name.substring(0, 200),
        brand: '',
        price: 0,
        url: `https://www.lowes.com${urlPath}`,
        image: '',
        source: 'LOWES',
      });

      if (products.length >= 24) break;
    }

    return products;
  }
}
