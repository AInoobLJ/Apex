import axios from 'axios';
import { logger } from '../lib/logger';
import { config } from '../config';

function getToken() { return process.env.TELEGRAM_BOT_TOKEN || ''; }
function getChatId() { return process.env.TELEGRAM_CHAT_ID || ''; }
function isEnabled() { return process.env.TELEGRAM_ENABLED === 'true'; }

export class TelegramService {
  async sendMessage(text: string, parseMode: 'HTML' | 'Markdown' = 'HTML'): Promise<boolean> {
    const token = getToken();
    const chatId = getChatId();
    if (!isEnabled() || !token || !chatId) {
      logger.debug('Telegram not configured, skipping message');
      return false;
    }

    try {
      await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }, { timeout: 10000 });
      return true;
    } catch (err) {
      logger.error(err, 'Failed to send Telegram message');
      return false;
    }
  }

  async sendAlert(title: string, message: string, severity: string): Promise<boolean> {
    const emoji = severity === 'CRITICAL' ? '🚨' : severity === 'HIGH' ? '🔥' : severity === 'MEDIUM' ? '🔔' : 'ℹ️';
    const text = `${emoji} <b>${title}</b>\n\n${message}`;
    return this.sendMessage(text);
  }

  async sendDailyDigest(data: {
    activeMarkets: number;
    topEdges: { title: string; ev: number }[];
    portfolioSummary: string;
    moduleHealth: string;
  }): Promise<boolean> {
    const edgeList = data.topEdges.length > 0
      ? data.topEdges.map(e => `  • ${e.title} (EV: ${(e.ev * 100).toFixed(2)}%)`).join('\n')
      : '  No actionable edges';

    const text = [
      `📊 <b>APEX Daily Digest</b>`,
      ``,
      `<b>Markets:</b> ${data.activeMarkets} active`,
      `<b>Top Edges:</b>`,
      edgeList,
      ``,
      `<b>Portfolio:</b> ${data.portfolioSummary}`,
      `<b>Module Health:</b> ${data.moduleHealth}`,
    ].join('\n');

    return this.sendMessage(text);
  }

  async testConnection(): Promise<boolean> {
    const token = getToken();
    if (!token) return false;
    try {
      const response = await axios.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 5000 });
      return response.data.ok === true;
    } catch {
      return false;
    }
  }
}

export const telegramService = new TelegramService();
