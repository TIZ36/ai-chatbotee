// =============================================================================
// Global State Store using Zustand
// =============================================================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, Thread, Chat, ChatMessage, FeedItem } from './types';

// =============================================================================
// Auth Store
// =============================================================================

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      setAuth: (user, token) => {
        set({ user, token, isAuthenticated: true });
        if (typeof window !== 'undefined') {
          localStorage.setItem('auth_token', token);
        }
      },
      logout: () => {
        set({ user: null, token: null, isAuthenticated: false });
        if (typeof window !== 'undefined') {
          localStorage.removeItem('auth_token');
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user, token: state.token }),
    }
  )
);

// =============================================================================
// Thread Store
// =============================================================================

interface ThreadState {
  threads: Thread[];
  currentThread: Thread | null;
  feed: FeedItem[];
  isLoading: boolean;
  setThreads: (threads: Thread[]) => void;
  addThread: (thread: Thread) => void;
  setCurrentThread: (thread: Thread | null) => void;
  setFeed: (feed: FeedItem[]) => void;
  appendFeed: (items: FeedItem[]) => void;
  setLoading: (loading: boolean) => void;
}

export const useThreadStore = create<ThreadState>((set) => ({
  threads: [],
  currentThread: null,
  feed: [],
  isLoading: false,
  setThreads: (threads) => set({ threads }),
  addThread: (thread) => set((state) => ({ threads: [thread, ...state.threads] })),
  setCurrentThread: (thread) => set({ currentThread: thread }),
  setFeed: (feed) => set({ feed }),
  appendFeed: (items) => set((state) => ({ feed: [...state.feed, ...items] })),
  setLoading: (isLoading) => set({ isLoading }),
}));

// =============================================================================
// Chat Store
// =============================================================================

interface ChatState {
  chats: Chat[];
  currentChat: Chat | null;
  messages: Record<string, ChatMessage[]>;
  isLoading: boolean;
  setChats: (chats: Chat[]) => void;
  addChat: (chat: Chat) => void;
  setCurrentChat: (chat: Chat | null) => void;
  setMessages: (chatKey: string, messages: ChatMessage[]) => void;
  addMessage: (chatKey: string, message: ChatMessage) => void;
  setLoading: (loading: boolean) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  chats: [],
  currentChat: null,
  messages: {},
  isLoading: false,
  setChats: (chats) => set({ chats }),
  addChat: (chat) => set((state) => ({ chats: [chat, ...state.chats] })),
  setCurrentChat: (chat) => set({ currentChat: chat }),
  setMessages: (chatKey, messages) =>
    set((state) => ({
      messages: { ...state.messages, [chatKey]: messages },
    })),
  addMessage: (chatKey, message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [chatKey]: [...(state.messages[chatKey] || []), message],
      },
    })),
  setLoading: (isLoading) => set({ isLoading }),
}));

// =============================================================================
// UI Store
// =============================================================================

interface UIState {
  sidebarOpen: boolean;
  activeTab: 'feed' | 'threads' | 'chats' | 'profile';
  showNewThreadModal: boolean;
  showNewChatModal: boolean;
  toggleSidebar: () => void;
  setActiveTab: (tab: 'feed' | 'threads' | 'chats' | 'profile') => void;
  setShowNewThreadModal: (show: boolean) => void;
  setShowNewChatModal: (show: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  activeTab: 'feed',
  showNewThreadModal: false,
  showNewChatModal: false,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setActiveTab: (activeTab) => set({ activeTab }),
  setShowNewThreadModal: (showNewThreadModal) => set({ showNewThreadModal }),
  setShowNewChatModal: (showNewChatModal) => set({ showNewChatModal }),
}));
