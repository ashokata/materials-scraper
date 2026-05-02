import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ProductDetails {
  sku: string;
  name: string;
  brand: string;
  description: string;
  price: number;
  originalPrice?: number;
  currency: string;
  availability: string;
  rating?: number;
  reviewCount?: number;
  images: string[];
  specifications: Record<string, string>;
  url: string;
  scrapedAt: string;
}

export interface SearchResult {
  products: ProductSummary[];
  totalResults: number;
  currentPage: number;
  query: string;
  scrapedAt: string;
}

export interface ProductSummary {
  sku: string;
  name: string;
  brand: string;
  price: number;
  originalPrice?: number;
  rating?: number;
  reviewCount?: number;
  image: string;
  url: string;
  availability: string;
}

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);
  private readonly baseHeaders: Record<string, string>;

  constructor(private configService: ConfigService) {
    this.baseHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'x-experience-name': 'general-merchandise',
      'x-hd-dc': 'origin',
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
    this.logger.log(`Searching for: ${query}, page: ${pageNum}`);

    const startIndex = (pageNum - 1) * 24;

    // Home Depot's search API endpoint
    const searchUrl = `https://www.homedepot.com/federation-gateway/graphql?opname=searchModel`;

    const graphqlQuery = {
      operationName: 'searchModel',
      variables: {
        storeId: '121',
        zipCode: '30301',
        skipInstallServices: true,
        startIndex: startIndex,
        pageSize: 24,
        orderBy: {
          field: 'TOP_SELLERS',
          order: 'ASC'
        },
        filter: {},
        keyword: query
      },
      query: `query searchModel($keyword: String!, $storeId: String, $zipCode: String, $pageSize: Int, $startIndex: Int, $orderBy: ProductSort, $filter: ProductFilter, $skipInstallServices: Boolean) {
        searchModel(keyword: $keyword, storeId: $storeId, zipCode: $zipCode, pageSize: $pageSize, startIndex: $startIndex, orderBy: $orderBy, filter: $filter, skipInstallServices: $skipInstallServices) {
          id
          searchReport {
            totalProducts
            keyword
          }
          products {
            itemId
            dataSources
            identifiers {
              productLabel
              canonicalUrl
              brandName
              itemId
              modelNumber
              productType
              storeSkuNumber
              parentId
            }
            media {
              images {
                url
                sizes
              }
            }
            pricing(storeId: $storeId) {
              original
              current
              percentageOff
              promotion {
                type
                description
              }
            }
            reviews {
              ratingsReviews {
                averageRating
                totalReviews
              }
            }
            availabilityType {
              type
            }
            fulfillment(storeId: $storeId, zipCode: $zipCode) {
              fulfillmentOptions {
                type
                services {
                  type
                  locations {
                    isAnchor
                    inventory {
                      isInStock
                      quantity
                    }
                  }
                }
              }
            }
          }
        }
      }`
    };

    try {
      const response = await this.fetchWithRetry(searchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(graphqlQuery),
      });

      const data = await response.json();

      if (data.errors) {
        this.logger.error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
        // Fall back to REST API
        return this.searchProductsREST(query, pageNum);
      }

      const searchModel = data.data?.searchModel;
      if (!searchModel) {
        this.logger.warn('No searchModel in response, falling back to REST API');
        return this.searchProductsREST(query, pageNum);
      }

      const products: ProductSummary[] = (searchModel.products || []).map((product: any) => {
        const identifiers = product.identifiers || {};
        const pricing = product.pricing || {};
        const reviews = product.reviews?.ratingsReviews || {};
        const media = product.media?.images?.[0] || {};

        return {
          sku: identifiers.itemId || identifiers.storeSkuNumber || '',
          name: identifiers.productLabel || '',
          brand: identifiers.brandName || '',
          price: pricing.current || pricing.original || 0,
          originalPrice: pricing.original !== pricing.current ? pricing.original : undefined,
          rating: reviews.averageRating,
          reviewCount: reviews.totalReviews,
          image: media.url ? `https://images.homedepot-static.com/productImages${media.url}` : '',
          url: identifiers.canonicalUrl ? `https://www.homedepot.com${identifiers.canonicalUrl}` : '',
          availability: product.availabilityType?.type || 'Check store',
        };
      });

      const totalResults = searchModel.searchReport?.totalProducts || products.length;

      this.logger.log(`Found ${products.length} products out of ${totalResults} total`);

      return {
        products,
        totalResults,
        currentPage: pageNum,
        query,
        scrapedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`GraphQL search failed: ${error}`);
      return this.searchProductsREST(query, pageNum);
    }
  }

  private async searchProductsREST(query: string, pageNum: number = 1): Promise<SearchResult> {
    this.logger.log(`Using REST API fallback for: ${query}`);

    const startIndex = (pageNum - 1) * 24;
    const searchUrl = `https://www.homedepot.com/b/N-5yc1v/Ntk-EnrichedProductInfo/Ntt-${encodeURIComponent(query)}?Nao=${startIndex}&format=json`;

    try {
      const response = await this.fetchWithRetry(searchUrl);
      const data = await response.json();

      const products: ProductSummary[] = [];
      const productsData = data.products || data.searchReport?.products || [];

      for (const product of productsData) {
        products.push({
          sku: product.itemId || product.productId || '',
          name: product.productName || product.title || '',
          brand: product.brandName || '',
          price: parseFloat(product.price?.value || product.pricing?.current || '0'),
          originalPrice: product.pricing?.original,
          rating: product.rating?.average,
          reviewCount: product.rating?.count,
          image: product.media?.image?.url || product.imageUrl || '',
          url: product.canonicalUrl ? `https://www.homedepot.com${product.canonicalUrl}` : '',
          availability: product.fulfillment?.availability || 'Check store',
        });
      }

      return {
        products,
        totalResults: data.searchReport?.totalProducts || products.length,
        currentPage: pageNum,
        query,
        scrapedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`REST search failed: ${error}`);
      // Final fallback - return empty with error info
      return {
        products: [],
        totalResults: 0,
        currentPage: pageNum,
        query,
        scrapedAt: new Date().toISOString(),
      };
    }
  }

  async scrapeProduct(productUrl: string): Promise<ProductDetails> {
    this.logger.log(`Fetching product: ${productUrl}`);

    // Extract item ID from URL
    const itemIdMatch = productUrl.match(/\/(\d{9})(?:[/?]|$)/);
    if (!itemIdMatch) {
      throw new Error('Could not extract item ID from URL');
    }
    const itemId = itemIdMatch[1];

    const graphqlUrl = 'https://www.homedepot.com/federation-gateway/graphql?opname=productClientOnlyProduct';

    const graphqlQuery = {
      operationName: 'productClientOnlyProduct',
      variables: {
        itemId: itemId,
        storeId: '121',
        zipCode: '30301'
      },
      query: `query productClientOnlyProduct($itemId: String!, $storeId: String, $zipCode: String) {
        product(itemId: $itemId) {
          itemId
          dataSources
          identifiers {
            productLabel
            canonicalUrl
            brandName
            itemId
            modelNumber
            storeSkuNumber
            upc
          }
          details {
            description
            highlights
            descriptiveAttributes {
              name
              value
            }
          }
          media {
            images {
              url
              type
              subType
              sizes
            }
          }
          pricing(storeId: $storeId) {
            original
            current
            percentageOff
          }
          reviews {
            ratingsReviews {
              averageRating
              totalReviews
            }
          }
          fulfillment(storeId: $storeId, zipCode: $zipCode) {
            fulfillmentOptions {
              type
              services {
                type
                locations {
                  isAnchor
                  inventory {
                    isInStock
                    quantity
                  }
                }
              }
            }
          }
          specificationGroup {
            specTitle
            specifications {
              specName
              specValue
            }
          }
        }
      }`
    };

    try {
      const response = await this.fetchWithRetry(graphqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(graphqlQuery),
      });

      const data = await response.json();

      if (data.errors || !data.data?.product) {
        this.logger.error(`GraphQL product fetch failed: ${JSON.stringify(data.errors)}`);
        return this.scrapeProductREST(productUrl, itemId);
      }

      const product = data.data.product;
      const identifiers = product.identifiers || {};
      const pricing = product.pricing || {};
      const reviews = product.reviews?.ratingsReviews || {};
      const details = product.details || {};

      // Extract images
      const images: string[] = [];
      for (const img of (product.media?.images || [])) {
        if (img.url) {
          images.push(`https://images.homedepot-static.com/productImages${img.url}`);
        }
      }

      // Extract specifications
      const specifications: Record<string, string> = {};
      for (const group of (product.specificationGroup || [])) {
        for (const spec of (group.specifications || [])) {
          if (spec.specName && spec.specValue) {
            specifications[spec.specName] = spec.specValue;
          }
        }
      }

      // Check availability
      let availability = 'Check store';
      const fulfillment = product.fulfillment?.fulfillmentOptions || [];
      for (const option of fulfillment) {
        for (const service of (option.services || [])) {
          for (const location of (service.locations || [])) {
            if (location.inventory?.isInStock) {
              availability = `In Stock (${location.inventory.quantity || 'Available'})`;
              break;
            }
          }
        }
      }

      return {
        sku: identifiers.itemId || identifiers.storeSkuNumber || itemId,
        name: identifiers.productLabel || '',
        brand: identifiers.brandName || '',
        description: details.description || details.highlights?.join(' ') || '',
        price: pricing.current || pricing.original || 0,
        originalPrice: pricing.original !== pricing.current ? pricing.original : undefined,
        currency: 'USD',
        availability,
        rating: reviews.averageRating,
        reviewCount: reviews.totalReviews,
        images,
        specifications,
        url: productUrl,
        scrapedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`GraphQL product fetch error: ${error}`);
      return this.scrapeProductREST(productUrl, itemId);
    }
  }

  private async scrapeProductREST(productUrl: string, itemId: string): Promise<ProductDetails> {
    this.logger.log(`Using REST fallback for product: ${itemId}`);

    const restUrl = `https://www.homedepot.com/p/svcs/frontEndModel/${itemId}?storeId=121`;

    try {
      const response = await this.fetchWithRetry(restUrl);
      const data = await response.json();

      const product = data.primaryItemData || data;

      return {
        sku: product.itemId || itemId,
        name: product.productLabel || '',
        brand: product.brandName || '',
        description: product.description || '',
        price: parseFloat(product.pricing?.current || '0'),
        originalPrice: product.pricing?.original,
        currency: 'USD',
        availability: product.fulfillment?.availability || 'Check store',
        rating: product.reviews?.averageRating,
        reviewCount: product.reviews?.totalReviews,
        images: product.media?.images?.map((img: any) => img.url) || [],
        specifications: {},
        url: productUrl,
        scrapedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`REST product fetch failed: ${error}`);
      return {
        sku: itemId,
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
  }

  async scrapeCategory(categoryUrl: string, pageNum: number = 1): Promise<SearchResult> {
    this.logger.log(`Fetching category: ${categoryUrl}`);

    // Extract category identifier from URL
    const nMatch = categoryUrl.match(/\/b\/([^/?]+)/);
    const category = nMatch ? nMatch[1] : '';

    const startIndex = (pageNum - 1) * 24;

    // Try to use the category API
    const apiUrl = `https://www.homedepot.com/b/${category}?Nao=${startIndex}&format=json`;

    try {
      const response = await this.fetchWithRetry(apiUrl);
      const data = await response.json();

      const products: ProductSummary[] = [];
      const productsData = data.products || [];

      for (const product of productsData) {
        products.push({
          sku: product.itemId || '',
          name: product.productName || '',
          brand: product.brandName || '',
          price: parseFloat(product.price?.value || '0'),
          image: product.media?.image?.url || '',
          url: product.canonicalUrl ? `https://www.homedepot.com${product.canonicalUrl}` : '',
          availability: 'Check store',
        });
      }

      return {
        products,
        totalResults: data.pagination?.totalProducts || products.length,
        currentPage: pageNum,
        query: categoryUrl,
        scrapedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Category fetch failed: ${error}`);
      return {
        products: [],
        totalResults: 0,
        currentPage: pageNum,
        query: categoryUrl,
        scrapedAt: new Date().toISOString(),
      };
    }
  }

  async getStoreAvailability(
    sku: string,
    zipCode: string,
  ): Promise<{ sku: string; zipCode: string; stores: any[]; scrapedAt: string }> {
    this.logger.log(`Checking availability for SKU: ${sku} near ${zipCode}`);

    const graphqlUrl = 'https://www.homedepot.com/federation-gateway/graphql?opname=storeSearch';

    const graphqlQuery = {
      operationName: 'storeSearch',
      variables: {
        zipCode: zipCode,
        itemId: sku,
        radius: 50,
        count: 10
      },
      query: `query storeSearch($zipCode: String!, $itemId: String, $radius: Int, $count: Int) {
        storeSearch(zipCode: $zipCode, radius: $radius, count: $count) {
          stores {
            storeId
            storeName
            address {
              street
              city
              state
              postalCode
            }
            distance
            inventory(itemId: $itemId) {
              isInStock
              quantity
              isLimitedQuantity
            }
          }
        }
      }`
    };

    try {
      const response = await this.fetchWithRetry(graphqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(graphqlQuery),
      });

      const data = await response.json();

      const storeSearch = data.data?.storeSearch;
      const stores = (storeSearch?.stores || []).map((store: any) => ({
        storeId: store.storeId,
        name: store.storeName,
        address: store.address ?
          `${store.address.street}, ${store.address.city}, ${store.address.state} ${store.address.postalCode}` : '',
        distance: store.distance ? `${store.distance} miles` : '',
        availability: store.inventory?.isInStock ?
          `In Stock (${store.inventory.quantity || 'Available'})` : 'Out of Stock',
        quantity: store.inventory?.quantity || 0,
        isLimitedQuantity: store.inventory?.isLimitedQuantity || false,
      }));

      return {
        sku,
        zipCode,
        stores,
        scrapedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Store availability fetch failed: ${error}`);
      return {
        sku,
        zipCode,
        stores: [],
        scrapedAt: new Date().toISOString(),
      };
    }
  }
}
