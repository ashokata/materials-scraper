# Materials Scraper API

A NestJS-based API service that scrapes product data from Home Depot and Lowes, stores it in PostgreSQL, and exposes it via REST API for the Infieldr pricebook feature.

## Features

- **Multi-source scraping**: Home Depot and Lowes product data
- **Real-time search**: Search products directly from retailer APIs
- **Database caching**: PostgreSQL storage with price history tracking
- **Scheduled scraping**: Nightly scrape jobs for field service categories
- **REST API**: Full CRUD operations for materials data
- **Docker ready**: Production-ready Docker deployment

## Tech Stack

- **Framework**: NestJS 11
- **Database**: PostgreSQL 16 with Prisma ORM
- **Scraping**: Native fetch with GraphQL/REST fallbacks
- **Scheduling**: @nestjs/schedule with cron jobs
- **Containerization**: Docker with docker-compose

## Quick Start

### Local Development

1. **Start PostgreSQL**:
```bash
docker-compose -f docker-compose.dev.yml up -d
```

2. **Install dependencies**:
```bash
npm install
```

3. **Run migrations**:
```bash
npx prisma migrate dev
```

4. **Start the server**:
```bash
npm run start:dev
```

### Production (Docker)

```bash
# Set environment variables
export DB_PASSWORD=your_secure_password
export API_USERNAME=admin
export API_PASSWORD=your_api_password

# Build and run
docker-compose up -d
```

## API Endpoints

All endpoints require Basic Authentication.

### Products (Real-time scraping)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/products/search?q=<query>&page=<num>` | GET | Search Home Depot products |
| `/api/products/details` | POST | Get product details by URL |
| `/api/products/availability` | POST | Check store availability |

### Materials (Cached data)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/materials` | GET | List materials (paginated, filterable) |
| `/api/materials/stats` | GET | Get database statistics |
| `/api/materials/categories` | GET | List categories |
| `/api/materials/brands` | GET | List brands |
| `/api/materials/sku/:sku` | GET | Get material by SKU |
| `/api/materials/:id` | GET | Get material by ID |
| `/api/materials/:id/price-history` | GET | Get price history |
| `/api/materials/:id` | DELETE | Delete material |
| `/api/materials/cleanup` | POST | Remove old materials |

### Scraping Jobs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/scrape/status` | GET | Get scraper status |
| `/api/scrape/jobs` | GET | List recent jobs |
| `/api/scrape/jobs/:id` | GET | Get job details |
| `/api/scrape/trigger` | POST | Trigger manual scrape |
| `/api/scrape/trigger/full` | POST | Trigger full category scrape |

## Usage Examples

### Search Products
```bash
curl -u admin:password \
  "http://localhost:3000/api/products/search?q=electrical%20outlet&page=1"
```

### Get Material by SKU
```bash
curl -u admin:password \
  "http://localhost:3000/api/materials/sku/123456789?source=HOMEDEPOT"
```

### Trigger Scrape
```bash
curl -X POST -u admin:password \
  -H "Content-Type: application/json" \
  -d '{"source":"HOMEDEPOT","query":"GFCI outlet","pages":3}' \
  "http://localhost:3000/api/scrape/trigger"
```

### Filter Materials
```bash
curl -u admin:password \
  "http://localhost:3000/api/materials?source=HOMEDEPOT&category=Electrical&minPrice=5&maxPrice=50&page=1&limit=24"
```

## Configuration

Environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `AUTH_USERNAME` | API basic auth username | `admin` |
| `AUTH_PASSWORD` | API basic auth password | Required |
| `PORT` | Server port | `3000` |
| `CACHE_TTL` | Cache TTL in seconds | `3600` |

## Scheduled Jobs

The service runs automatic scraping jobs:

- **Nightly full scrape**: 2:00 AM daily
- **Categories**: Electrical, Plumbing, HVAC, Hardware
- **Rate limiting**: 2-5 second delays between requests

## Database Schema

### Material
- `id`, `sku`, `source` (HOMEDEPOT/LOWES)
- `name`, `brand`, `category`, `subcategory`
- `price`, `originalPrice`, `availability`
- `imageUrl`, `productUrl`, `specifications`
- `rating`, `reviewCount`
- `lastScrapedAt`, `createdAt`, `updatedAt`

### PriceHistory
- Tracks price changes over time
- Auto-records on material upsert

### ScrapeJob
- Tracks scraping job status
- Includes `itemsScraped`, `errorMessage`, timestamps

## Deployment to VPS

For Hostinger VPS with Traefik:

1. Clone repo to VPS
2. Create `.env.production` with secure credentials
3. Ensure Traefik network exists: `docker network create traefik_network`
4. Deploy: `docker-compose up -d`
5. Access at `https://materials.infieldr.io`

## Integration with Infieldr

The Infieldr pricebook can call this API to:
1. Search for materials by name
2. Get SKU-based pricing
3. Track price history
4. Auto-populate estimate line items

## License

Private - Infield Works LLC
