// =============================================================================
// Type Definitions for Chatee API
// =============================================================================

// Common Types
export type AuthorType = 'USER' | 'AI';
export type ContentType = 'TEXT' | 'IMAGE' | 'VIDEO' | 'FILE' | 'AUDIO';

export interface BaseMessage {
  msg_id: string;
  author_id: string;
  author_type: AuthorType;
  content_type: ContentType;
  raw_content: string;
  mentions?: string[];
  timestamp: number;
  metadata?: Record<string, string>;
}

export interface PageRequest {
  page_size?: number;
  page_token?: string;
}

export interface PageResponse {
  next_page_token?: string;
  total_count?: number;
  has_more?: boolean;
}

// =============================================================================
// User Types
// =============================================================================

export interface User {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  bio?: string;
  follower_count: number;
  following_count: number;
  created_at: number;
  updated_at: number;
}

export interface UserProfile extends User {
  is_following?: boolean;
  is_followed_by?: boolean;
}

// =============================================================================
// Thread Types
// =============================================================================

export type ThreadStatus = 'THREAD_ACTIVE' | 'THREAD_CLOSED' | 'THREAD_ARCHIVED';

export interface ThreadSettings {
  allow_replies: boolean;
  max_depth: number;
  require_follow: boolean;
  allowed_users?: string[];
}

export interface ThreadStats {
  reply_count: number;
  participant_count: number;
  last_msg_id?: string;
  last_active_at: number;
  hot_score: number;
}

export interface Thread {
  thread_id: string;
  owner_id: string;
  root_msg_id: string;
  title?: string;
  status: ThreadStatus;
  settings: ThreadSettings;
  stats: ThreadStats;
  ai_agents?: string[];
  created_at: number;
  updated_at: number;
  // Extended fields from API
  owner?: User;
  root_message?: ThreadMessage;
}

export interface ThreadMessage {
  base: BaseMessage;
  thread_id: string;
  parent_msg_id?: string;
  depth: number;
  is_root: boolean;
  // Extended
  author?: User;
  replies?: ThreadMessage[];
}

export interface CreateThreadRequest {
  title?: string;
  content: string;
  content_type?: ContentType;
  settings?: Partial<ThreadSettings>;
  ai_agents?: string[];
}

export interface CreateReplyRequest {
  thread_id: string;
  parent_msg_id?: string;
  content: string;
  content_type?: ContentType;
}

// =============================================================================
// Chat Types
// =============================================================================

export type ChatType = 'PRIVATE' | 'GROUP';
export type ChatStatus = 'CHAT_ACTIVE' | 'CHAT_MUTED' | 'CHAT_ARCHIVED';
export type ParticipantRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface ChatSettings {
  mute_notifications: boolean;
  only_admin_can_send: boolean;
  max_participants: number;
  allow_ai: boolean;
}

export interface ChatStats {
  message_count: number;
  last_msg_id?: string;
  last_active_at: number;
}

export interface Participant {
  user_id: string;
  role: ParticipantRole;
  joined_at: number;
  last_read_at: number;
  last_read_msg_id?: string;
  is_ai: boolean;
  // Extended
  user?: User;
}

export interface Chat {
  chat_key: string;
  chat_type: ChatType;
  title?: string;
  created_by: string;
  status: ChatStatus;
  settings: ChatSettings;
  stats: ChatStats;
  participants: Participant[];
  ai_agents?: string[];
  created_at: number;
  updated_at: number;
  // Extended
  unread_count?: number;
  last_message?: ChatMessage;
}

export interface ChatMessage {
  base: BaseMessage;
  chat_key: string;
  chat_type: string;
  // Extended
  author?: User;
}

export interface CreateChatRequest {
  chat_type: ChatType;
  title?: string;
  participant_ids: string[];
  ai_agents?: string[];
}

export interface SendMessageRequest {
  chat_key: string;
  content: string;
  content_type?: ContentType;
  mentions?: string[];
}

// =============================================================================
// Follow Types
// =============================================================================

export interface FollowRelation {
  follower_id: string;
  following_id: string;
  created_at: number;
  follower?: User;
  following?: User;
}

// =============================================================================
// API Response Types
// =============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface ListResponse<T> extends PageResponse {
  items: T[];
}

// =============================================================================
// Feed Types
// =============================================================================

export interface FeedItem {
  type: 'thread' | 'reply' | 'mention';
  thread?: Thread;
  message?: ThreadMessage;
  created_at: number;
  is_read: boolean;
}
