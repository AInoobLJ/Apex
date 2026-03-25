import axios from 'axios';
import { logger } from '../lib/logger';
import { logApiUsage } from './api-usage-logger';

export interface NewsArticle {
  title: string;
  description: string;
  source: string;
  publishedAt: string;
  url: string;
  category?: string;
}

const NEWSAPI_BASE = 'https://newsapi.org/v2';

/**
 * Fetch recent news articles from NewsAPI.
 * Returns empty array if NEWSAPI_KEY is not configured.
 */
export async function fetchNews(query?: string, pageSize = 20): Promise<NewsArticle[]> {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) {
    logger.debug('NEWSAPI_KEY not configured, skipping news fetch');
    return [];
  }

  const start = Date.now();
  try {
    const response = await axios.get(`${NEWSAPI_BASE}/everything`, {
      params: {
        q: query || 'prediction market OR election OR federal reserve OR bitcoin OR crypto',
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: Math.min(pageSize, 100),
        apiKey,
      },
      timeout: 15000,
    });

    await logApiUsage({
      service: 'newsapi',
      endpoint: 'GET /everything',
      latencyMs: Date.now() - start,
      statusCode: response.status,
    });

    const articles: NewsArticle[] = (response.data.articles || []).map((a: any) => ({
      title: a.title || '',
      description: a.description || '',
      source: a.source?.name || 'Unknown',
      publishedAt: a.publishedAt || new Date().toISOString(),
      url: a.url || '',
    }));

    return articles;
  } catch (err) {
    await logApiUsage({
      service: 'newsapi',
      endpoint: 'GET /everything',
      latencyMs: Date.now() - start,
      statusCode: axios.isAxiosError(err) ? (err.response?.status ?? 0) : 0,
    });
    logger.error(err, 'NewsAPI fetch failed');
    return [];
  }
}

/**
 * Fetch top headlines by category.
 */
export async function fetchHeadlines(category: string = 'general', pageSize = 10): Promise<NewsArticle[]> {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) return [];

  const start = Date.now();
  try {
    const response = await axios.get(`${NEWSAPI_BASE}/top-headlines`, {
      params: { country: 'us', category, pageSize, apiKey },
      timeout: 15000,
    });

    await logApiUsage({
      service: 'newsapi',
      endpoint: 'GET /top-headlines',
      latencyMs: Date.now() - start,
      statusCode: response.status,
    });

    return (response.data.articles || []).map((a: any) => ({
      title: a.title || '',
      description: a.description || '',
      source: a.source?.name || 'Unknown',
      publishedAt: a.publishedAt || new Date().toISOString(),
      url: a.url || '',
      category,
    }));
  } catch (err) {
    logger.error(err, 'NewsAPI headlines fetch failed');
    return [];
  }
}
