/**
 * Local Home Depot Scraper
 *
 * Run this on your local PC (not the VPS) to scrape products
 * and push them to the Materials API.
 *
 * Usage: node local-scraper.js "search term"
 * Example: node local-scraper.js "GFCI outlet"
 */

const { chromium } = require('playwright');

const API_URL = 'https://materials.infieldr.tech';
const API_USER = 'admin';
const API_PASS = 'Infieldr_Materials_2024!';

const SEARCH_TERM = process.argv[2] || 'GFCI outlet';

async function scrapeHomeDepot(searchTerm) {
  console.log(`\nScraping Home Depot for: "${searchTerm}"`);

  // Launch VISIBLE browser (not headless) - this is key to avoiding detection
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100 // Slow down to appear more human
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();
  const products = [];

  try {
    // Navigate to search
    const searchUrl = `https://www.homedepot.com/s/${encodeURIComponent(searchTerm)}`;
    console.log(`Loading: ${searchUrl}`);

    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 60000 });

    // Wait for products to load
    await page.waitForTimeout(3000);

    // Check if we got blocked
    const title = await page.title();
    if (title.includes('Error') || title.includes('Access Denied')) {
      console.log('Blocked! Try again in a few minutes or use a VPN.');
      await browser.close();
      return [];
    }

    console.log(`Page loaded: ${title}`);

    // Find all product pods
    const productPods = await page.$$('[data-testid="product-pod"], .product-pod, [class*="product-card"]');
    console.log(`Found ${productPods.length} product elements`);

    for (const pod of productPods.slice(0, 24)) { // First 24 products
      try {
        const product = await pod.evaluate(el => {
          // Extract data from product pod
          const nameEl = el.querySelector('[data-testid="product-header"], .product-title, h2, [class*="product-name"]');
          const priceEl = el.querySelector('[data-testid="price-value"], .price, [class*="price"]');
          const brandEl = el.querySelector('[data-testid="product-brand"], .brand, [class*="brand"]');
          const linkEl = el.querySelector('a[href*="/p/"]');
          const imgEl = el.querySelector('img');
          const ratingEl = el.querySelector('[class*="rating"], [data-testid="ratings"]');

          // Extract SKU from URL
          const href = linkEl?.href || '';
          const skuMatch = href.match(/\/(\d{9})(?:[/?]|$)/);

          return {
            name: nameEl?.textContent?.trim() || '',
            price: parseFloat(priceEl?.textContent?.replace(/[^0-9.]/g, '') || '0'),
            brand: brandEl?.textContent?.trim() || '',
            sku: skuMatch ? skuMatch[1] : '',
            url: href,
            image: imgEl?.src || '',
            rating: parseFloat(ratingEl?.textContent?.match(/[\d.]+/)?.[0] || '0')
          };
        });

        if (product.name && product.sku) {
          products.push(product);
          console.log(`  - ${product.brand} ${product.name.substring(0, 50)}... $${product.price}`);
        }
      } catch (e) {
        // Skip this product
      }
    }

  } catch (error) {
    console.error('Scraping error:', error.message);
  }

  await browser.close();
  return products;
}

async function pushToAPI(products, category) {
  console.log(`\nPushing ${products.length} products to API...`);

  const auth = Buffer.from(`${API_USER}:${API_PASS}`).toString('base64');

  let success = 0;
  let failed = 0;

  for (const product of products) {
    try {
      // Use the products/details endpoint to save
      const response = await fetch(`${API_URL}/api/materials`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sku: product.sku,
          source: 'HOMEDEPOT',
          name: product.name,
          brand: product.brand,
          category: category,
          price: product.price,
          imageUrl: product.image,
          productUrl: product.url,
          rating: product.rating,
          availability: 'Check store'
        })
      });

      if (response.ok) {
        success++;
      } else {
        failed++;
        console.log(`  Failed: ${product.sku} - ${response.status}`);
      }
    } catch (e) {
      failed++;
    }
  }

  console.log(`Pushed: ${success} success, ${failed} failed`);
}

async function main() {
  console.log('='.repeat(50));
  console.log('Home Depot Local Scraper');
  console.log('='.repeat(50));

  const products = await scrapeHomeDepot(SEARCH_TERM);

  if (products.length > 0) {
    console.log(`\nScraped ${products.length} products`);

    // Determine category from search term
    const category = SEARCH_TERM.toLowerCase().includes('electric') ? 'Electrical' :
                    SEARCH_TERM.toLowerCase().includes('plumb') ? 'Plumbing' :
                    SEARCH_TERM.toLowerCase().includes('hvac') ? 'HVAC' : 'General';

    await pushToAPI(products, category);
  } else {
    console.log('\nNo products found. This could mean:');
    console.log('1. Home Depot blocked the request');
    console.log('2. The page structure changed');
    console.log('3. Network issue');
    console.log('\nTry running again or use a VPN.');
  }

  console.log('\nDone!');
}

main().catch(console.error);
