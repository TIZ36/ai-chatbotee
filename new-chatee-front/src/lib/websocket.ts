// =============================================================================
// WebSocket Client for Real-time Updates
// =============================================================================

type MessageHandler = (data: unknown) => void;

interface WSMessage {
  type: string;
  payload: unknown;
}

class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private isConnecting = false;

  constructor(url: string = 'ws://localhost:8081/ws') {
    this.url = url;
  }

  connect(token?: string): Promise<void> {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      const wsUrl = token ? `${this.url}?token=${token}` : this.url;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data);
          this.dispatch(message.type, message.payload);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.isConnecting = false;
        this.attemptReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.isConnecting = false;
        reject(error);
      };
    });
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(type: string, payload: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    } else {
      console.warn('WebSocket not connected');
    }
  }

  subscribe(type: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  private dispatch(type: string, payload: unknown) {
    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.forEach((handler) => handler(payload));
    }

    // Also dispatch to wildcard handlers
    const wildcardHandlers = this.handlers.get('*');
    if (wildcardHandlers) {
      wildcardHandlers.forEach((handler) => handler({ type, payload }));
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
export const wsClient = new WebSocketClient();

// Message types
export const WS_EVENTS = {
  // Thread events
  THREAD_NEW: 'thread.new',
  THREAD_REPLY: 'thread.reply',
  THREAD_UPDATE: 'thread.update',
  THREAD_DELETE: 'thread.delete',
  
  // Chat events
  CHAT_MESSAGE: 'chat.message',
  CHAT_READ: 'chat.read',
  CHAT_TYPING: 'chat.typing',
  
  // User events
  USER_ONLINE: 'user.online',
  USER_OFFLINE: 'user.offline',
  USER_FOLLOW: 'user.follow',
  USER_UNFOLLOW: 'user.unfollow',
  
  // Notification events
  NOTIFICATION: 'notification',
} as const;

export default wsClient;
