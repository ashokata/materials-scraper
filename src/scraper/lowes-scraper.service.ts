import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductDetails, ProductSummary, SearchResult } from './scraper.service';

@Injectable()
export class LowesScraperService {
  private readonly logger = new Logger(LowesScraperService.name);
  private readonly baseHeaders: Record<string, string>;

  constructor(private configService: ConfigService) {
    this.baseHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
    };
  }

  private async fetchWithRetry(url: string, options: RequestInit = {}, retries = 3): Promise<Response> {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            ...this.baseHeaders,
            ...options.headers,
          },
        });
        if (response.ok) return response;
        this.logger.warn(`Request failed with status ${response.status}, retry ${i + 1}/${retries}`);
      } catch (error) {
        this.logger.warn(`Request error: ${error}, retry ${i + 1}/${retries}`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
    throw new Error(`Failed to fetch ${url} after ${retries} retries`);
  }

  async searchProducts(query: string, pageNum: number = 1): Promise<SearchResult> {
    this.logger.log(`Searching Lowes for: ${query}, page: ${pageNum}`);

    const offset = (pageNum - 1) * 24;

    // Lowes search API endpoint
    const searchUrl = `https://www.lowes.com/pd/search-api/v1/search?searchTerm=${encodeURIComponent(query)}&offset=${offset}&maxResults=24&nValue=&storeNumber=0595&deliveryZipCode=30301`;

    try {
      const response = await this.fetchWithRetry(searchUrl);
      const data = await response.json();

      const products: ProductSummary[] = [];
      const productsData = data.productResults || data.products || [];

      for (const product of productsData) {
        products.push({
          sku: product.productId || product.omniItemId || '',
          name: product.description || product.title || '',
          brand: product.brand || '',
          price: this.parsePrice(product.price?.sellingPrice || product.price?.itemPrice || product.price),
          originalPrice: this.parsePrice(product.price?.wasPrice),
          rating: product.rating?.average || product.averageRating,
          reviewCount: product.rating?.count || product.numberOfReviews,
          image: product.imageUrl || product.images?.[0]?.url || '',
          url: product.pdURL ? `https://www.lowes.com${product.pdURL}` : '',
          availability: product.fulfillment?.availabilityMessage || 'Check store',
        });
      }

      return {
        products,
        totalResults: data.totalResults || data.count || products.length,
        currentPage: pageNum,
        query,
        scrapedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Lowes search failed: ${error}`);
      return this.searchProductsFallback(query, pageNum);
    }
  }

  private async searchProductsFallback(query: string, pageNum: number): Promise<SearchResult> {
    this.logger.log(`Using fallback search for Lowes: ${query}`);

    const offset = (pageNum - 1) * 24;
    const fallbackUrl = `https://www.lowes.com/search?searchTerm=${encodeURIComponent(query)}&offset=${offset}`;

    try {
      const response = await this.fetchWithRetry(fallbackUrl, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
        },
      });

      const html = await response.text();

      // Extract JSON data from script tag
      const jsonMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
      if (jsonMatch) {
        const nextData = JSON.parse(jsonMatch[1]);
        const searchResults = nextData?.props?.pageProps?.searchResults || {};
        const productsData = searchResults.products || [];

        const products: ProductSummary[] = productsData.map((product: any) => ({
          sku: product.productId || '',
          name: product.description || '',
          brand: product.brand || '',
          price: this.parsePrice(product.price?.sellingPrice),
          originalPrice: this.parsePrice(product.price?.wasPrice),
          rating: product.rating?.average,
          reviewCount: product.rating?.count,
          image: product.imageUrl || '',
          url: product.pdURL ? `https://www.lowes.com${product.pdURL}` : '',
          availability: 'Check store',
        }));

        return {
          products,
          totalResults: searchResults.totalResults || products.length,
          currentPage: pageNum,
          query,
          scrapedAt: new Date().toISOString(),
        };
      }
    } catch (error) {
      this.logger.error(`Fallback search failed: ${error}`);
    }

    return {
      products: [],
      totalResults: 0,
      currentPage: pageNum,
      query,
      scrapedAt: new Date().toISOString(),
    };
  }

  async scrapeProduct(productUrl: string): Promise<ProductDetails> {
    this.logger.log(`Fetching Lowes product: ${productUrl}`);

    // Extract product ID from URL (format: /pd/Product-Name/PRODUCTID)
    const productIdMatch = productUrl.match(/\/pd\/[^/]+\/(\d+)/);
    if (!productIdMatch) {
      throw new Error('Could not extract product ID from Lowes URL');
    }
    const productId = productIdMatch[1];

    const apiUrl = `https://www.lowes.com/pd/api/productdetail/${productId}`;

    try {
      const response = await this.fetchWithRetry(apiUrl);
      const data = await response.json();

      const product = data.productDetails || data;

      // Extract specifications
      const specifications: Record<string, string> = {};
      for (const spec of (product.specifications || [])) {
        if (spec.name && spec.value) {
          specifications[spec.name] = spec.value;
        }
      }

      // Extract images
      const images: string[] = [];
      for (const img of (product.images || [])) {
        if (img.url) {
          images.push(img.url.startsWith('http') ? img.url : `https://www.lowes.com${img.url}`);
        }
      }

      return {
        sku: product.productId || productId,
        name: product.description || product.title || '',
        brand: product.brand || '',
        description: product.longDescription || product.shortDescription || '',
        price: this.parsePrice(product.price?.sellingPrice || product.price?.itemPrice),
        originalPrice: this.parsePrice(product.price?.wasPrice),
        currency: 'USD',
        availability: product.fulfillment?.availabilityMessage || 'Check store',
        rating: product.rating?.average,
        reviewCount: product.rating?.count,
        images,
        specifications,
        url: productUrl,
        scrapedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Lowes product fetch failed: ${error}`);
      return this.scrapeProductFallback(productUrl, productId);
    }
  }

  private async scrapeProductFallback(productUrl: string, productId: string): Promise<ProductDetails> {
    this.logger.log(`Using fallback for Lowes product: ${productId}`);

    try {
      const response = await this.fetchWithRetry(productUrl, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
        },
      });

      const html = await response.text();

      // Extract JSON-LD or Next.js data
      const jsonLdMatch = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
      if (jsonLdMatch) {
        const jsonLd = JSON.parse(jsonLdMatch[1]);
        const product = Array.isArray(jsonLd) ? jsonLd[0] : jsonLd;

        return {
          sku: productId,
          name: product.name || '',
          brand: product.brand?.name || '',
          description: product.description || '',
          price: this.parsePrice(product.offers?.price),
          currency: product.offers?.priceCurrency || 'USD',
          availability: product.offers?.availability?.includes('InStock') ? 'In Stock' : 'Check store',
          rating: product.aggregateRating?.ratingValue,
          reviewCount: product.aggregateRating?.reviewCount,
          images: product.image ? [product.image] : [],
          specifications: {},
          url: productUrl,
          scrapedAt: new Date().toISOString(),
        };
      }
    } catch (error) {
      this.logger.error(`Fallback product fetch failed: ${error}`);
    }

    return {
      sku: productId,
      name: '',
      brand: '',
      description: '',
      price: 0,
      currency: 'USD',
      availability: 'Unknown',
      images: [],
      specifications: {},
      url: productUrl,
      scrapedAt: new Date().toISOString(),
    };
  }

  async getStoreAvailability(
    sku: string,
    zipCode: string,
  ): Promise<{ sku: string; zipCode: string; stores: any[]; scrapedAt: string }> {
    this.logger.log(`Checking Lowes availability for SKU: ${sku} near ${zipCode}`);

    const apiUrl = `https://www.lowes.com/pd/api/product/${sku}/storelocator/${zipCode}?radius=50`;

    try {
      const response = await this.fetchWithRetry(apiUrl);
      const data = await response.json();

      const stores = (data.stores || []).map((store: any) => ({
        storeId: store.storeNumber || store.id,
        name: store.storeName || store.name,
        address: store.address ?
          `${store.address.street}, ${store.address.city}, ${store.address.state} ${store.address.zip}` : '',
        distance: store.distance ? `${store.distance} miles` : '',
        availability: store.inventory?.available ?
          `In Stock (${store.inventory.quantity || 'Available'})` : 'Out of Stock',
        quantity: store.inventory?.quantity || 0,
      }));

      return {
        sku,
        zipCode,
        stores,
        scrapedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Lowes store availability fetch failed: ${error}`);
      return {
        sku,
        zipCode,
        stores: [],
        scrapedAt: new Date().toISOString(),
      };
    }
  }

  private parsePrice(value: any): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const cleaned = value.replace(/[^0-9.]/g, '');
      return parseFloat(cleaned) || 0;
    }
    return 0;
  }
}
