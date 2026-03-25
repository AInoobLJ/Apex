interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text: string;
    chat: { id: number };
    reply_to_message?: { message_id: number };
  };
}

interface PendingExecution {
  messageId: number;
  edgeId: string;
  marketId: string;
  platform: string;
  createdAt: number;
  expiresAt: number; // 2 hours
}

/**
 * Telegram reply listener for SLOW_EXEC trades.
 * Polls getUpdates every 5 seconds for ✅/❌ replies.
 */
export class TelegramReplyListener {
  private botToken: string;
  private chatId: string;
  private pending: Map<number, PendingExecution> = new Map();
  private lastUpdateId = 0;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(botToken: string, chatId: string) {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  addPendingExecution(messageId: number, execution: Omit<PendingExecution, 'messageId' | 'createdAt' | 'expiresAt'>): void {
    this.pending.set(messageId, {
      ...execution,
      messageId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 2 * 60 * 60 * 1000, // 2 hours
    });
  }

  start(
    onApprove: (execution: PendingExecution) => Promise<void>,
    onReject: (execution: PendingExecution) => void
  ): void {
    this.pollInterval = setInterval(async () => {
      // Expire old pending executions
      for (const [msgId, exec] of this.pending) {
        if (Date.now() > exec.expiresAt) {
          onReject(exec);
          this.pending.delete(msgId);
        }
      }

      // Poll for updates
      try {
        const response = await fetch(
          `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=1`
        );
        const data = await response.json() as { ok: boolean; result: TelegramUpdate[] };

        if (!data.ok) return;

        for (const update of data.result) {
          this.lastUpdateId = update.update_id;
          const msg = update.message;
          if (!msg?.reply_to_message || String(msg.chat.id) !== this.chatId) continue;

          const replyToId = msg.reply_to_message.message_id;
          const pending = this.pending.get(replyToId);
          if (!pending) continue;

          const text = msg.text?.trim();
          if (text === '✅' || text?.toLowerCase() === 'yes' || text?.toLowerCase() === 'y') {
            await onApprove(pending);
            this.pending.delete(replyToId);
          } else if (text === '❌' || text?.toLowerCase() === 'no' || text?.toLowerCase() === 'n') {
            onReject(pending);
            this.pending.delete(replyToId);
          }
        }
      } catch {
        // Silently continue on poll failure
      }
    }, 5000);
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}
