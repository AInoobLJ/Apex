import { useEffect, useRef, useCallback } from 'react';

type WsHandler = (event: string, data: unknown) => void;

const WS_URL = `ws://localhost:3001/ws?apiKey=${import.meta.env.VITE_API_KEY || ''}`;

export function useWebSocket(onMessage: WsHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);

      ws.onmessage = (e) => {
        try {
          const { event, data } = JSON.parse(e.data);
          handlerRef.current(event, data);
        } catch { /* ignore parse errors */ }
      };

      ws.onclose = () => {
        // Reconnect after 3 seconds
        setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };

      wsRef.current = ws;
    } catch { /* ignore connection errors */ }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);
}
