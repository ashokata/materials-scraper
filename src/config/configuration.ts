export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  auth: {
    username: process.env.AUTH_USERNAME || 'admin',
    password: process.env.AUTH_PASSWORD || 'password',
  },
  cache: {
    ttl: parseInt(process.env.CACHE_TTL || '3600', 10),
  },
  scraper: {
    timeout: parseInt(process.env.SCRAPER_TIMEOUT || '30000', 10),
    headless: process.env.SCRAPER_HEADLESS !== 'false',
  },
});
