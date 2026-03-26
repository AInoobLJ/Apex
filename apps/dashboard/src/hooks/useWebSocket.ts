import { useEffect, useRef, useCallback } from 'react';

type WsHandler = (event: string, data: unknown) => void;

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';
const API_KEY = import.meta.env.VITE_API_KEY || '';

// Derive WS URL from API URL: http://host:port/api/v1 → ws://host:port/ws
function getWsBaseUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const url = new URL(API_BASE);
  const wsProto = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProto}//${url.host}/ws`;
}

async function getWsTicket(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE.replace('/api/v1', '')}/api/v1/auth/ws-ticket`, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
    });
    if (!res.ok) return null;
    const { ticket } = await res.json();
    return ticket;
  } catch {
    return null;
  }
}

export function useWebSocket(onMessage: WsHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  const connect = useCallback(async () => {
    try {
      // Get ticket-based auth token (60 second TTL, single use)
      const ticket = await getWsTicket();
      const wsUrl = ticket
        ? `${getWsBaseUrl()}?ticket=${ticket}`
        : `${getWsBaseUrl()}?apiKey=${API_KEY}`; // legacy fallback

      const ws = new WebSocket(wsUrl);

      ws.onmessage = (e) => {
        try {
          const { event, data } = JSON.parse(e.data);
          handlerRef.current(event, data);
        } catch (err) {
          console.debug('WebSocket message parse error:', err);
        }
      };

      ws.onclose = () => {
        setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };

      wsRef.current = ws;
    } catch (err) {
      console.debug('WebSocket connection error:', err);
      setTimeout(connect, 5000);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);
}
