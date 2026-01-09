-- Chatee Database Schema
-- Version: 1.0.0

-- ============================================================================
-- Users Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS `users` (
    `id` VARCHAR(64) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `avatar` VARCHAR(512) DEFAULT NULL,
    `role` VARCHAR(32) NOT NULL DEFAULT 'user',
    `preferences` JSON DEFAULT NULL,
    `metadata` JSON DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_email` (`email`),
    KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Sessions Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS `sessions` (
    `id` VARCHAR(64) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `agent_id` VARCHAR(64) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'active',
    `metadata` JSON DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_agent_id` (`agent_id`),
    KEY `idx_user_updated` (`user_id`, `updated_at` DESC),
    KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Agents Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS `agents` (
    `id` VARCHAR(64) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `description` TEXT DEFAULT NULL,
    `system_prompt` TEXT NOT NULL,
    `model` VARCHAR(64) NOT NULL,
    `provider` VARCHAR(32) NOT NULL,
    `persona` JSON DEFAULT NULL,
    `mcp_servers` JSON DEFAULT NULL,
    `is_default` TINYINT(1) NOT NULL DEFAULT 0,
    `is_public` TINYINT(1) NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_is_default` (`is_default`),
    KEY `idx_is_public` (`is_public`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Messages Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS `messages` (
    `id` VARCHAR(64) NOT NULL,
    `session_id` VARCHAR(64) NOT NULL,
    `role` VARCHAR(32) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `tool_calls` JSON DEFAULT NULL,
    `tool_call_id` VARCHAR(64) DEFAULT NULL,
    `metadata` JSON DEFAULT NULL,
    `created_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    KEY `idx_session_id` (`session_id`),
    KEY `idx_session_created` (`session_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- LLM Configs Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS `llm_configs` (
    `id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `provider` VARCHAR(32) NOT NULL,
    `api_key` VARCHAR(512) NOT NULL,
    `base_url` VARCHAR(512) DEFAULT NULL,
    `models` JSON DEFAULT NULL,
    `is_default` TINYINT(1) NOT NULL DEFAULT 0,
    `is_enabled` TINYINT(1) NOT NULL DEFAULT 1,
    `settings` JSON DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_name` (`name`),
    KEY `idx_provider` (`provider`),
    KEY `idx_is_default` (`is_default`),
    KEY `idx_is_enabled` (`is_enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- MCP Servers Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS `mcp_servers` (
    `id` VARCHAR(64) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `description` TEXT DEFAULT NULL,
    `type` VARCHAR(32) NOT NULL,
    `url` VARCHAR(512) DEFAULT NULL,
    `command` VARCHAR(512) DEFAULT NULL,
    `args` JSON DEFAULT NULL,
    `env` JSON DEFAULT NULL,
    `headers` JSON DEFAULT NULL,
    `auth_type` VARCHAR(32) NOT NULL DEFAULT 'none',
    `auth_config` JSON DEFAULT NULL,
    `is_enabled` TINYINT(1) NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_is_enabled` (`is_enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Threads Table (for Topic-based messaging)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `threads` (
    `id` VARCHAR(64) NOT NULL,
    `author_id` VARCHAR(64) NOT NULL,
    `author_type` VARCHAR(32) NOT NULL, -- user, agent
    `title` VARCHAR(255) DEFAULT NULL,
    `content` LONGTEXT NOT NULL,
    `content_type` VARCHAR(32) NOT NULL DEFAULT 'text',
    `reply_count` INT NOT NULL DEFAULT 0,
    `like_count` INT NOT NULL DEFAULT 0,
    `visibility` VARCHAR(32) NOT NULL DEFAULT 'public',
    `tags` JSON DEFAULT NULL,
    `metadata` JSON DEFAULT NULL,
    `created_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_author` (`author_id`, `author_type`),
    KEY `idx_created_at` (`created_at` DESC),
    KEY `idx_visibility` (`visibility`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Thread Replies Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS `thread_replies` (
    `id` VARCHAR(64) NOT NULL,
    `thread_id` VARCHAR(64) NOT NULL,
    `parent_id` VARCHAR(64) DEFAULT NULL,
    `author_id` VARCHAR(64) NOT NULL,
    `author_type` VARCHAR(32) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `content_type` VARCHAR(32) NOT NULL DEFAULT 'text',
    `like_count` INT NOT NULL DEFAULT 0,
    `metadata` JSON DEFAULT NULL,
    `created_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    KEY `idx_thread_id` (`thread_id`),
    KEY `idx_parent_id` (`parent_id`),
    KEY `idx_thread_created` (`thread_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Chats Table (for Private/Group messaging)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `chats` (
    `id` VARCHAR(64) NOT NULL,
    `type` VARCHAR(32) NOT NULL, -- private, group
    `name` VARCHAR(128) DEFAULT NULL,
    `description` TEXT DEFAULT NULL,
    `avatar` VARCHAR(512) DEFAULT NULL,
    `owner_id` VARCHAR(64) NOT NULL,
    `participant_count` INT NOT NULL DEFAULT 0,
    `channel_count` INT NOT NULL DEFAULT 1,
    `settings` JSON DEFAULT NULL,
    `metadata` JSON DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_owner_id` (`owner_id`),
    KEY `idx_type` (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Chat Participants Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS `chat_participants` (
    `chat_id` VARCHAR(64) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `role` VARCHAR(32) NOT NULL DEFAULT 'member', -- owner, admin, member
    `nickname` VARCHAR(64) DEFAULT NULL,
    `muted` TINYINT(1) NOT NULL DEFAULT 0,
    `joined_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `last_read_at` TIMESTAMP DEFAULT NULL,
    PRIMARY KEY (`chat_id`, `user_id`),
    KEY `idx_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Chat Channels Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS `chat_channels` (
    `id` VARCHAR(64) NOT NULL,
    `chat_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `description` TEXT DEFAULT NULL,
    `is_default` TINYINT(1) NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_chat_id` (`chat_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Action Chains Table (for tracking agent action chains)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `action_chains` (
    `id` VARCHAR(64) NOT NULL,
    `session_id` VARCHAR(64) NOT NULL,
    `agent_id` VARCHAR(64) NOT NULL,
    `message_id` VARCHAR(64) DEFAULT NULL,
    `name` VARCHAR(128) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `step_count` INT NOT NULL DEFAULT 0,
    `current_step` INT NOT NULL DEFAULT 0,
    `context` JSON DEFAULT NULL,
    `started_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ended_at` TIMESTAMP(3) DEFAULT NULL,
    `duration_ms` INT DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_session_id` (`session_id`),
    KEY `idx_agent_id` (`agent_id`),
    KEY `idx_status` (`status`),
    KEY `idx_started_at` (`started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Action Steps Table (for tracking individual steps)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `action_steps` (
    `id` VARCHAR(64) NOT NULL,
    `chain_id` VARCHAR(64) NOT NULL,
    `step_index` INT NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `params` JSON DEFAULT NULL,
    `result` JSON DEFAULT NULL,
    `error` TEXT DEFAULT NULL,
    `started_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ended_at` TIMESTAMP(3) DEFAULT NULL,
    `duration_ms` INT DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_chain_id` (`chain_id`),
    KEY `idx_type` (`type`),
    KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Tool Calls Table (for MCP tool call logs)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `tool_calls` (
    `id` VARCHAR(64) NOT NULL,
    `step_id` VARCHAR(64) DEFAULT NULL,
    `session_id` VARCHAR(64) NOT NULL,
    `server_id` VARCHAR(64) NOT NULL,
    `tool_name` VARCHAR(128) NOT NULL,
    `arguments` JSON DEFAULT NULL,
    `result` JSON DEFAULT NULL,
    `is_error` TINYINT(1) NOT NULL DEFAULT 0,
    `started_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ended_at` TIMESTAMP(3) DEFAULT NULL,
    `duration_ms` INT DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_step_id` (`step_id`),
    KEY `idx_session_id` (`session_id`),
    KEY `idx_server_id` (`server_id`),
    KEY `idx_tool_name` (`tool_name`),
    KEY `idx_started_at` (`started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
