// =============================================================================
// API Client for Chatee Backend
// =============================================================================

import type {
  ApiResponse,
  ListResponse,
  User,
  UserProfile,
  Thread,
  ThreadMessage,
  CreateThreadRequest,
  CreateReplyRequest,
  Chat,
  ChatMessage,
  CreateChatRequest,
  SendMessageRequest,
  FollowRelation,
  FeedItem,
  PageRequest,
} from './types';

const API_BASE = '/api/v1';

// =============================================================================
// Base Fetch Wrapper
// =============================================================================

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const url = `${API_BASE}${endpoint}`;
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Add auth token if available
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('auth_token');
    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: {
          code: data.code || 'UNKNOWN_ERROR',
          message: data.message || 'An error occurred',
        },
      };
    }

    return {
      success: true,
      data: data.data || data,
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Network error',
      },
    };
  }
}

// =============================================================================
// Auth API
// =============================================================================

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: User;
  expires_at: number;
}

export const authApi = {
  login: (data: LoginRequest) =>
    fetchApi<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  logout: () =>
    fetchApi<void>('/auth/logout', {
      method: 'POST',
    }),

  refresh: () =>
    fetchApi<LoginResponse>('/auth/refresh', {
      method: 'POST',
    }),
};

// =============================================================================
// User API
// =============================================================================

export const userApi = {
  getUser: (id: string) =>
    fetchApi<UserProfile>(`/users/${id}`),

  updateUser: (id: string, data: Partial<User>) =>
    fetchApi<User>(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  getUserSessions: (id: string) =>
    fetchApi<ListResponse<unknown>>(`/users/${id}/sessions`),

  // Follow operations
  follow: (userId: string) =>
    fetchApi<void>(`/users/${userId}/follow`, {
      method: 'POST',
    }),

  unfollow: (userId: string) =>
    fetchApi<void>(`/users/${userId}/follow`, {
      method: 'DELETE',
    }),

  getFollowers: (userId: string, page?: PageRequest) =>
    fetchApi<ListResponse<FollowRelation>>(
      `/users/${userId}/followers?page_size=${page?.page_size || 20}&page_token=${page?.page_token || ''}`
    ),

  getFollowing: (userId: string, page?: PageRequest) =>
    fetchApi<ListResponse<FollowRelation>>(
      `/users/${userId}/following?page_size=${page?.page_size || 20}&page_token=${page?.page_token || ''}`
    ),
};

// =============================================================================
// Thread API
// =============================================================================

export const threadApi = {
  createThread: (data: CreateThreadRequest) =>
    fetchApi<{ thread_id: string; msg_id: string }>('/threads', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getThread: (id: string) =>
    fetchApi<Thread>(`/threads/${id}`),

  updateThread: (id: string, data: Partial<Thread>) =>
    fetchApi<Thread>(`/threads/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteThread: (id: string) =>
    fetchApi<void>(`/threads/${id}`, {
      method: 'DELETE',
    }),

  listThreads: (page?: PageRequest & { user_id?: string }) =>
    fetchApi<ListResponse<Thread>>(
      `/threads?page_size=${page?.page_size || 20}&page_token=${page?.page_token || ''}${page?.user_id ? `&user_id=${page.user_id}` : ''}`
    ),

  // Replies
  createReply: (data: CreateReplyRequest) =>
    fetchApi<{ msg_id: string }>(`/threads/${data.thread_id}/replies`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  listReplies: (threadId: string, page?: PageRequest & { parent_msg_id?: string }) =>
    fetchApi<ListResponse<ThreadMessage>>(
      `/threads/${threadId}/replies?page_size=${page?.page_size || 50}&page_token=${page?.page_token || ''}${page?.parent_msg_id ? `&parent_msg_id=${page.parent_msg_id}` : ''}`
    ),

  // Feed
  getFeed: (page?: PageRequest) =>
    fetchApi<ListResponse<FeedItem>>(
      `/feed?page_size=${page?.page_size || 20}&page_token=${page?.page_token || ''}`
    ),
};

// =============================================================================
// Chat API
// =============================================================================

export const chatApi = {
  createChat: (data: CreateChatRequest) =>
    fetchApi<{ chat_key: string }>('/chats', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getChat: (id: string) =>
    fetchApi<Chat>(`/chats/${id}`),

  updateChat: (id: string, data: Partial<Chat>) =>
    fetchApi<Chat>(`/chats/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteChat: (id: string) =>
    fetchApi<void>(`/chats/${id}`, {
      method: 'DELETE',
    }),

  listChats: (page?: PageRequest) =>
    fetchApi<ListResponse<Chat>>(
      `/chats?page_size=${page?.page_size || 20}&page_token=${page?.page_token || ''}`
    ),

  // Participants
  addParticipant: (chatId: string, userId: string) =>
    fetchApi<void>(`/chats/${chatId}/participants`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    }),

  removeParticipant: (chatId: string, userId: string) =>
    fetchApi<void>(`/chats/${chatId}/participants/${userId}`, {
      method: 'DELETE',
    }),

  // Messages
  sendMessage: (data: SendMessageRequest) =>
    fetchApi<{ msg_id: string }>(`/chats/${data.chat_key}/messages`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getMessages: (chatKey: string, page?: PageRequest) =>
    fetchApi<ListResponse<ChatMessage>>(
      `/chats/${chatKey}/messages?page_size=${page?.page_size || 50}&page_token=${page?.page_token || ''}`
    ),

  // Channels
  createChannel: (chatId: string, name: string) =>
    fetchApi<{ channel_id: string }>(`/chats/${chatId}/channels`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  listChannels: (chatId: string) =>
    fetchApi<ListResponse<unknown>>(`/chats/${chatId}/channels`),

  // Read status
  markAsRead: (chatKey: string, msgId: string) =>
    fetchApi<void>(`/chats/${chatKey}/read`, {
      method: 'POST',
      body: JSON.stringify({ msg_id: msgId }),
    }),
};

// =============================================================================
// Export all APIs
// =============================================================================

export const api = {
  auth: authApi,
  user: userApi,
  thread: threadApi,
  chat: chatApi,
};

export default api;
