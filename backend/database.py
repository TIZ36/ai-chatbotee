"""
数据库初始化和管理模块
支持MySQL和Redis连接检测、表创建等
使用连接池管理MySQL连接，提高稳定性和性能
"""

import sys
from typing import Optional, Tuple
from pathlib import Path

# MySQL连接池相关
mysql_pool = None
mysql_config = None

# Redis相关
redis_client = None
redis_config = None

def init_mysql(config: dict) -> Tuple[bool, Optional[str]]:
    """
    初始化MySQL连接池并创建表
    
    Returns:
        (success: bool, error_message: Optional[str])
    """
    global mysql_pool, mysql_config
    
    mysql_config = config.get('mysql', {})
    
    if not mysql_config.get('enabled', False):
        print("MySQL is disabled in config")
        return True, None
    
    try:
        import pymysql
        from dbutils.pooled_db import PooledDB
        
        host = mysql_config.get('host', 'localhost')
        port = mysql_config.get('port', 3306)
        user = mysql_config.get('user', 'root')
        password = mysql_config.get('password', '')
        database = mysql_config.get('database', 'youtube_downloader')
        charset = mysql_config.get('charset', 'utf8mb4')
        pool_size = mysql_config.get('pool_size', 10)
        
        print(f"Connecting to MySQL at {host}:{port}...")
        
        # 先连接MySQL服务器（不指定数据库）创建数据库
        try:
            conn = pymysql.connect(
                host=host,
                port=port,
                user=user,
                password=password,
                charset=charset,
                connect_timeout=10
            )
            cursor = conn.cursor()
            
            # 检查数据库是否存在，不存在则创建
            cursor.execute(f"SHOW DATABASES LIKE '{database}'")
            if not cursor.fetchone():
                print(f"Database '{database}' does not exist, creating...")
                cursor.execute(f"CREATE DATABASE IF NOT EXISTS `{database}` CHARACTER SET {charset} COLLATE {charset}_unicode_ci")
                print(f"Database '{database}' created successfully")
            
            cursor.close()
            conn.close()
            
        except pymysql.Error as e:
            error_msg = f"MySQL connection error: {e}"
            print(f"✗ {error_msg}")
            return False, error_msg
        
        # 创建连接池
        print(f"Creating MySQL connection pool (size={pool_size})...")
        
        mysql_pool = PooledDB(
            creator=pymysql,              # 使用pymysql作为数据库连接库
            maxconnections=pool_size,     # 连接池最大连接数
            mincached=2,                   # 初始化时至少创建的空闲连接
            maxcached=5,                   # 连接池中最多闲置的连接数
            maxshared=0,                   # 不共享连接（0表示每个线程独立连接）
            blocking=True,                 # 连接池满时阻塞等待，而不是报错
            maxusage=None,                 # 单个连接最多被重复使用的次数（None表示无限制）
            setsession=[],                 # 开始会话前执行的命令列表
            ping=1,                        # ping MySQL服务端，检查连接是否可用（0=不ping，1=默认ping，2=乐观ping，4=悲观ping）
            host=host,
            port=port,
            user=user,
            password=password,
            database=database,
            charset=charset,
            autocommit=True,
            connect_timeout=10,
            read_timeout=30,
            write_timeout=30
        )
        
        print(f"✓ MySQL connection pool created successfully (pool_size={pool_size})")
        
        # 创建表
        create_tables()
        
        return True, None
        
    except ImportError as e:
        if 'dbutils' in str(e).lower():
            error_msg = "DBUtils is not installed. Install it with: pip install DBUtils"
        elif 'pymysql' in str(e):
            error_msg = "pymysql is not installed. Install it with: pip install pymysql"
        else:
            error_msg = f"Import error: {e}"
        print(f"✗ {error_msg}")
        return False, error_msg
    except Exception as e:
        error_msg = f"MySQL pool initialization error: {e}"
        print(f"✗ {error_msg}")
        import traceback
        traceback.print_exc()
        return False, error_msg

def create_tables():
    """创建必要的数据库表"""
    conn = get_mysql_connection()
    if not conn:
        return
    
    try:
        cursor = conn.cursor()
        
        # 下载相关表已移除（工作流工具不需要）
        # LLM配置表
        create_llm_configs_table = """
        CREATE TABLE IF NOT EXISTS `llm_configs` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `config_id` VARCHAR(100) NOT NULL UNIQUE COMMENT '配置ID',
            `name` VARCHAR(255) NOT NULL COMMENT '配置名称',
            `provider` VARCHAR(50) NOT NULL COMMENT '提供商: openai, anthropic, ollama, local, custom',
            `api_key` TEXT DEFAULT NULL COMMENT 'API密钥',
            `api_url` TEXT DEFAULT NULL COMMENT 'API地址',
            `model` VARCHAR(255) DEFAULT NULL COMMENT '模型名称',
            `tags` JSON DEFAULT NULL COMMENT '标签列表',
            `enabled` TINYINT(1) DEFAULT 1 COMMENT '是否启用',
            `description` TEXT DEFAULT NULL COMMENT '描述',
            `metadata` JSON DEFAULT NULL COMMENT '元数据',
            `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
            `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
            INDEX `idx_config_id` (`config_id`),
            INDEX `idx_provider` (`provider`),
            INDEX `idx_enabled` (`enabled`),
            INDEX `idx_created_at` (`created_at`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='LLM配置表';
        """
        
        cursor.execute(create_llm_configs_table)
        print("✓ Table 'llm_configs' created/verified successfully")
        
        # MCP服务器配置表
        create_mcp_servers_table = """
        CREATE TABLE IF NOT EXISTS `mcp_servers` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `server_id` VARCHAR(100) NOT NULL UNIQUE COMMENT '服务器ID',
            `name` VARCHAR(255) NOT NULL COMMENT '服务器名称',
            `url` TEXT NOT NULL COMMENT '服务器URL',
            `type` VARCHAR(50) NOT NULL DEFAULT 'http-stream' COMMENT '服务器类型: http-stream, http-post, stdio',
            `enabled` TINYINT(1) DEFAULT 1 COMMENT '是否启用',
            `use_proxy` TINYINT(1) DEFAULT 1 COMMENT '是否使用代理（解决CORS问题）',
            `description` TEXT DEFAULT NULL COMMENT '描述',
            `metadata` JSON DEFAULT NULL COMMENT '元数据',
            `ext` JSON DEFAULT NULL COMMENT '扩展配置（存储特殊MCP服务器的额外配置，如Notion的Internal Integration Secret）',
            `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
            `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
            INDEX `idx_server_id` (`server_id`),
            INDEX `idx_enabled` (`enabled`),
            INDEX `idx_created_at` (`created_at`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='MCP服务器配置表';
        """
        
        cursor.execute(create_mcp_servers_table)
        print("✓ Table 'mcp_servers' created/verified successfully")
        
        # 迁移：为已存在的表添加 ext 列（如果不存在）
        try:
            cursor.execute("""
                SELECT COUNT(*) 
                FROM information_schema.COLUMNS 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_NAME = 'mcp_servers' 
                AND COLUMN_NAME = 'ext'
            """)
            ext_column_exists = cursor.fetchone()[0] > 0
            
            if not ext_column_exists:
                print("  → Adding 'ext' column to 'mcp_servers' table...")
                cursor.execute("""
                    ALTER TABLE `mcp_servers` 
                    ADD COLUMN `ext` JSON DEFAULT NULL COMMENT '扩展配置（存储特殊MCP服务器的额外配置，如Notion的Internal Integration Secret）' 
                    AFTER `metadata`
                """)
                print("  ✓ Column 'ext' added successfully")
            else:
                print("  ✓ Column 'ext' already exists")
        except Exception as e:
            print(f"  ⚠ Warning: Could not check/add 'ext' column: {e}")
        
        # 创建 OAuth tokens 表
        create_oauth_tokens_table = """
        CREATE TABLE IF NOT EXISTS `oauth_tokens` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `client_id` VARCHAR(255) NOT NULL COMMENT 'OAuth Client ID',
            `access_token` TEXT NOT NULL COMMENT 'Access Token',
            `refresh_token` TEXT DEFAULT NULL COMMENT 'Refresh Token',
            `token_type` VARCHAR(50) DEFAULT 'bearer' COMMENT 'Token类型',
            `expires_in` INT DEFAULT NULL COMMENT '过期时间（秒）',
            `expires_at` BIGINT DEFAULT NULL COMMENT '过期时间戳',
            `scope` TEXT DEFAULT NULL COMMENT '权限范围',
            `mcp_url` TEXT DEFAULT NULL COMMENT 'MCP服务器URL',
            `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
            `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
            UNIQUE KEY `uk_client_id` (`client_id`),
            INDEX `idx_mcp_url` (`mcp_url`(255)),
            INDEX `idx_expires_at` (`expires_at`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='OAuth Token存储表';
        """
        
        cursor.execute(create_oauth_tokens_table)
        print("✓ Table 'oauth_tokens' created/verified successfully")
        
        # Notion 注册信息表
        create_notion_registrations_table = """
        CREATE TABLE IF NOT EXISTS `notion_registrations` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `client_id` VARCHAR(255) NOT NULL UNIQUE COMMENT 'Notion OAuth Client ID',
            `client_name` VARCHAR(255) NOT NULL COMMENT '客户端名称（用户输入）',
            `redirect_uri` TEXT NOT NULL COMMENT '完整回调地址',
            `redirect_uri_base` VARCHAR(500) DEFAULT NULL COMMENT '回调地址基础部分（用户输入）',
            `client_uri` VARCHAR(500) DEFAULT NULL COMMENT '客户端 URI',
            `registration_data` JSON DEFAULT NULL COMMENT '完整注册响应数据',
            `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
            `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
            INDEX `idx_client_id` (`client_id`),
            INDEX `idx_client_name` (`client_name`),
            INDEX `idx_created_at` (`created_at`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Notion MCP 注册信息表';
        """
        
        cursor.execute(create_notion_registrations_table)
        print("✓ Table 'notion_registrations' created/verified successfully")
        
        # 迁移：为 oauth_tokens 表添加 notion_registration_id 字段（如果不存在）
        try:
            cursor.execute("""
                SELECT COUNT(*) 
                FROM information_schema.COLUMNS 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_NAME = 'oauth_tokens' 
                AND COLUMN_NAME = 'notion_registration_id'
            """)
            notion_reg_id_column_exists = cursor.fetchone()[0] > 0
            
            if not notion_reg_id_column_exists:
                print("  → Adding 'notion_registration_id' column to 'oauth_tokens' table...")
                cursor.execute("""
                    ALTER TABLE `oauth_tokens` 
                    ADD COLUMN `notion_registration_id` INT DEFAULT NULL COMMENT '关联的 Notion 注册信息 ID' 
                    AFTER `mcp_url`,
                    ADD CONSTRAINT `fk_oauth_tokens_notion_reg` 
                    FOREIGN KEY (`notion_registration_id`) 
                    REFERENCES `notion_registrations`(`id`) 
                    ON DELETE SET NULL
                """)
                print("  ✓ Column 'notion_registration_id' added successfully")
            else:
                print("  ✓ Column 'notion_registration_id' already exists")
        except Exception as e:
            print(f"  ⚠ Warning: Could not check/add 'notion_registration_id' column: {e}")
        
        # 工作流配置表
        create_workflows_table = """
        CREATE TABLE IF NOT EXISTS `workflows` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `workflow_id` VARCHAR(100) NOT NULL UNIQUE COMMENT '工作流ID',
            `name` VARCHAR(255) NOT NULL COMMENT '工作流名称',
            `description` TEXT DEFAULT NULL COMMENT '工作流描述',
            `config` JSON NOT NULL COMMENT '工作流配置（节点、连接等）',
            `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
            `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
            INDEX `idx_workflow_id` (`workflow_id`),
            INDEX `idx_created_at` (`created_at`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工作流配置表';
        """
        
        cursor.execute(create_workflows_table)
        print("✓ Table 'workflows' created/verified successfully")
        
        # 会话表
        create_sessions_table = """
        CREATE TABLE IF NOT EXISTS `sessions` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `session_id` VARCHAR(100) NOT NULL UNIQUE COMMENT '会话ID',
            `title` VARCHAR(255) DEFAULT NULL COMMENT '会话标题（自动生成或用户设置）',
            `name` VARCHAR(255) DEFAULT NULL COMMENT '用户自定义会话名称',
            `llm_config_id` VARCHAR(100) DEFAULT NULL COMMENT '使用的LLM配置ID',
            `avatar` MEDIUMTEXT DEFAULT NULL COMMENT '机器人头像（base64编码）',
            `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
            `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
            `last_message_at` DATETIME DEFAULT NULL COMMENT '最后消息时间',
            INDEX `idx_session_id` (`session_id`),
            INDEX `idx_llm_config_id` (`llm_config_id`),
            INDEX `idx_created_at` (`created_at`),
            INDEX `idx_last_message_at` (`last_message_at`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会话表';
        """
        
        cursor.execute(create_sessions_table)
        print("✓ Table 'sessions' created/verified successfully")
        
        # 迁移：为已存在的表添加 name 列（如果不存在）
        try:
            cursor.execute("""
                SELECT COUNT(*) 
                FROM information_schema.COLUMNS 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_NAME = 'sessions' 
                AND COLUMN_NAME = 'name'
            """)
            name_column_exists = cursor.fetchone()[0] > 0
            
            if not name_column_exists:
                print("  → Adding 'name' column to 'sessions' table...")
                cursor.execute("""
                    ALTER TABLE `sessions` 
                    ADD COLUMN `name` VARCHAR(255) DEFAULT NULL COMMENT '用户自定义会话名称' 
                    AFTER `title`
                """)
                conn.commit()
                print("  ✓ Column 'name' added to 'sessions' table")
        except Exception as e:
            print(f"  ⚠️ Warning: Failed to add 'name' column: {e}")
        
        # 迁移：为已存在的表添加 system_prompt 列（用于存储会话人设）
        try:
            cursor.execute("""
                SELECT COUNT(*) 
                FROM information_schema.COLUMNS 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_NAME = 'sessions' 
                AND COLUMN_NAME = 'system_prompt'
            """)
            system_prompt_exists = cursor.fetchone()[0] > 0
            
            if not system_prompt_exists:
                print("  → Adding 'system_prompt' column to 'sessions' table...")
                cursor.execute("""
                    ALTER TABLE `sessions` 
                    ADD COLUMN `system_prompt` TEXT DEFAULT NULL COMMENT '系统提示词（人设）' 
                    AFTER `avatar`
                """)
                print("  ✓ Column 'system_prompt' added successfully")
            else:
                print("  ✓ Column 'system_prompt' already exists")
        except Exception as e:
            print(f"  ⚠️ Warning: Failed to add 'system_prompt' column: {e}")
        
        # 迁移：为已存在的表添加 session_type 列（会话类型：temporary/memory/agent）
        try:
            cursor.execute("""
                SELECT COUNT(*) 
                FROM information_schema.COLUMNS 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_NAME = 'sessions' 
                AND COLUMN_NAME = 'session_type'
            """)
            session_type_exists = cursor.fetchone()[0] > 0
            
            if not session_type_exists:
                print("  → Adding 'session_type' column to 'sessions' table...")
                cursor.execute("""
                    ALTER TABLE `sessions` 
                    ADD COLUMN `session_type` VARCHAR(20) DEFAULT 'memory' COMMENT '会话类型：temporary(临时会话)/memory(记忆体)/agent(智能体)' 
                    AFTER `llm_config_id`
                """)
                conn.commit()
                print("  ✓ Column 'session_type' added to 'sessions' table")
            else:
                print("  ✓ Column 'session_type' already exists")
        except Exception as e:
            print(f"  ⚠️ Warning: Failed to add 'session_type' column: {e}")
        
        # 迁移：为已存在的表添加或修改 avatar 列（如果不存在或类型不对）
        try:
            cursor.execute("""
                SELECT COLUMN_TYPE 
                FROM information_schema.COLUMNS 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_NAME = 'sessions' 
                AND COLUMN_NAME = 'avatar'
            """)
            avatar_column = cursor.fetchone()
            
            if not avatar_column:
                # 列不存在，添加它
                print("  → Adding 'avatar' column to 'sessions' table...")
                cursor.execute("""
                    ALTER TABLE `sessions` 
                    ADD COLUMN `avatar` MEDIUMTEXT DEFAULT NULL COMMENT '机器人头像（base64编码）' 
                    AFTER `llm_config_id`
                """)
                print("  ✓ Column 'avatar' added successfully")
            else:
                # 列存在，检查类型是否为 MEDIUMTEXT
                column_type = avatar_column[0].upper()
                if 'TEXT' in column_type and 'MEDIUMTEXT' not in column_type:
                    # 如果是 TEXT 类型，修改为 MEDIUMTEXT
                    print("  → Updating 'avatar' column type from TEXT to MEDIUMTEXT...")
                    cursor.execute("""
                        ALTER TABLE `sessions` 
                        MODIFY COLUMN `avatar` MEDIUMTEXT DEFAULT NULL COMMENT '机器人头像（base64编码）'
                    """)
                    print("  ✓ Column 'avatar' type updated to MEDIUMTEXT")
                else:
                    print("  ✓ Column 'avatar' already exists with correct type")
        except Exception as e:
            print(f"  ⚠ Warning: Could not check/add 'avatar' column: {e}")
        
        # 消息表
        create_messages_table = """
        CREATE TABLE IF NOT EXISTS `messages` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `message_id` VARCHAR(100) NOT NULL UNIQUE COMMENT '消息ID',
            `session_id` VARCHAR(100) NOT NULL COMMENT '会话ID',
            `role` VARCHAR(20) NOT NULL COMMENT '角色: user, assistant, system, tool',
            `content` TEXT NOT NULL COMMENT '消息内容',
            `thinking` TEXT DEFAULT NULL COMMENT '思考过程（用于o1等思考模型）',
            `tool_calls` JSON DEFAULT NULL COMMENT '工具调用信息',
            `token_count` INT DEFAULT NULL COMMENT 'Token数量（估算）',
            `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
            INDEX `idx_message_id` (`message_id`),
            INDEX `idx_session_id` (`session_id`),
            INDEX `idx_created_at` (`created_at`),
            INDEX `idx_session_created` (`session_id`, `created_at`),
            FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='消息表';
        """
        
        cursor.execute(create_messages_table)
        print("✓ Table 'messages' created/verified successfully")
        
        # 迁移：为已存在的表添加 acc_token 列（如果不存在）
        try:
            cursor.execute("""
                SELECT COUNT(*) 
                FROM information_schema.COLUMNS 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_NAME = 'messages' 
                AND COLUMN_NAME = 'acc_token'
            """)
            acc_token_column_exists = cursor.fetchone()[0] > 0
            
            if not acc_token_column_exists:
                print("  → Adding 'acc_token' column to 'messages' table...")
                cursor.execute("""
                    ALTER TABLE `messages` 
                    ADD COLUMN `acc_token` INT DEFAULT NULL COMMENT '累积Token数量（直到该消息为止）' 
                    AFTER `token_count`
                """)
                print("  ✓ Column 'acc_token' added successfully")
            else:
                print("  ✓ Column 'acc_token' already exists")
        except Exception as e:
            print(f"  ⚠ Warning: Could not check/add 'acc_token' column: {e}")
        
        # 迁移：为已存在的表添加 ext 列（如果不存在）- 用于存储扩展数据
        # 如 Gemini 的 thoughtSignature、模型信息、thinking配置等
        try:
            cursor.execute("""
                SELECT COUNT(*) 
                FROM information_schema.COLUMNS 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_NAME = 'messages' 
                AND COLUMN_NAME = 'ext'
            """)
            ext_column_exists = cursor.fetchone()[0] > 0
            
            if not ext_column_exists:
                print("  → Adding 'ext' column to 'messages' table...")
                cursor.execute("""
                    ALTER TABLE `messages` 
                    ADD COLUMN `ext` JSON DEFAULT NULL COMMENT '扩展数据(JSON): 思维签名、模型信息等' 
                    AFTER `acc_token`
                """)
                print("  ✓ Column 'ext' added successfully")
            else:
                print("  ✓ Column 'ext' already exists")
        except Exception as e:
            print(f"  ⚠ Warning: Could not check/add 'ext' column: {e}")
        
        # 总结表
        create_summaries_table = """
        CREATE TABLE IF NOT EXISTS `summaries` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `summary_id` VARCHAR(100) NOT NULL UNIQUE COMMENT '总结ID',
            `session_id` VARCHAR(100) NOT NULL COMMENT '会话ID',
            `summary_content` TEXT NOT NULL COMMENT '总结内容',
            `last_message_id` VARCHAR(100) DEFAULT NULL COMMENT '总结时的最后消息ID',
            `token_count_before` INT DEFAULT NULL COMMENT '总结前的Token数量',
            `token_count_after` INT DEFAULT NULL COMMENT '总结后的Token数量',
            `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
            INDEX `idx_summary_id` (`summary_id`),
            INDEX `idx_session_id` (`session_id`),
            INDEX `idx_created_at` (`created_at`),
            FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='总结表';
        """
        
        cursor.execute(create_summaries_table)
        print("✓ Table 'summaries' created/verified successfully")
        
        # 消息执行记录表
        create_message_executions_table = """
        CREATE TABLE IF NOT EXISTS `message_executions` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `execution_id` VARCHAR(100) NOT NULL UNIQUE COMMENT '执行ID',
            `message_id` VARCHAR(100) NOT NULL COMMENT '消息ID',
            `component_type` VARCHAR(20) NOT NULL COMMENT '感知组件类型: mcp, workflow',
            `component_id` VARCHAR(100) NOT NULL COMMENT '感知组件ID',
            `component_name` VARCHAR(255) DEFAULT NULL COMMENT '感知组件名称',
            `llm_config_id` VARCHAR(100) DEFAULT NULL COMMENT '使用的LLM配置ID',
            `input` TEXT DEFAULT NULL COMMENT '输入内容',
            `result` TEXT DEFAULT NULL COMMENT '执行结果',
            `status` VARCHAR(20) DEFAULT 'pending' COMMENT '执行状态: pending, running, completed, error',
            `error_message` TEXT DEFAULT NULL COMMENT '错误信息',
            `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
            `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
            INDEX `idx_execution_id` (`execution_id`),
            INDEX `idx_message_id` (`message_id`),
            INDEX `idx_component_type` (`component_type`),
            INDEX `idx_component_id` (`component_id`),
            INDEX `idx_status` (`status`),
            INDEX `idx_created_at` (`created_at`),
            FOREIGN KEY (`message_id`) REFERENCES `messages`(`message_id`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='消息执行记录表';
        """
        
        cursor.execute(create_message_executions_table)
        print("✓ Table 'message_executions' created/verified successfully")
        
        # 爬虫模块表
        create_crawler_modules_table = """
        CREATE TABLE IF NOT EXISTS `crawler_modules` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `module_id` VARCHAR(100) NOT NULL UNIQUE COMMENT '模块ID',
            `module_name` VARCHAR(255) NOT NULL COMMENT '模块名称',
            `description` TEXT DEFAULT NULL COMMENT '模块描述',
            `target_url` TEXT NOT NULL COMMENT '目标URL',
            `crawler_options` JSON DEFAULT NULL COMMENT '爬虫配置（认证信息等）',
            `normalize_config` JSON DEFAULT NULL COMMENT '标准化配置',
            `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
            `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
            INDEX `idx_module_id` (`module_id`),
            INDEX `idx_module_name` (`module_name`),
            INDEX `idx_created_at` (`created_at`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='爬虫模块表';
        """
        
        cursor.execute(create_crawler_modules_table)
        print("✓ Table 'crawler_modules' created/verified successfully")
        
        # 爬虫子批次表
        create_crawler_batches_table = """
        CREATE TABLE IF NOT EXISTS `crawler_batches` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `batch_id` VARCHAR(100) NOT NULL UNIQUE COMMENT '批次ID',
            `module_id` VARCHAR(100) NOT NULL COMMENT '所属模块ID',
            `batch_name` VARCHAR(255) NOT NULL COMMENT '批次名称（如日期）',
            `crawled_data` JSON NOT NULL COMMENT '爬取的数据（标准化后）',
            `parsed_data` JSON DEFAULT NULL COMMENT '用户标记后生成的解析数据',
            `crawler_config_snapshot` JSON DEFAULT NULL COMMENT '爬虫配置快照（用于快速创建新批次）',
            `crawled_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '爬取时间',
            `status` VARCHAR(20) DEFAULT 'completed' COMMENT '状态：pending, running, completed, error',
            `error_message` TEXT DEFAULT NULL COMMENT '错误信息',
            INDEX `idx_batch_id` (`batch_id`),
            INDEX `idx_module_id` (`module_id`),
            INDEX `idx_batch_name` (`batch_name`),
            INDEX `idx_crawled_at` (`crawled_at`),
            FOREIGN KEY (`module_id`) REFERENCES `crawler_modules`(`module_id`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='爬虫子批次表';
        """
        
        cursor.execute(create_crawler_batches_table)
        print("✓ Table 'crawler_batches' created/verified successfully")
        
        # 检查并添加 parsed_data 列（如果不存在）
        try:
            cursor.execute("""
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_NAME = 'crawler_batches' 
                AND COLUMN_NAME = 'parsed_data'
            """)
            if not cursor.fetchone():
                print("Adding 'parsed_data' column to 'crawler_batches' table...")
                cursor.execute("""
                    ALTER TABLE `crawler_batches` 
                    ADD COLUMN `parsed_data` JSON DEFAULT NULL COMMENT '用户标记后生成的解析数据' 
                    AFTER `crawled_data`
                """)
                print("✓ Column 'parsed_data' added successfully")
            else:
                print("✓ Column 'parsed_data' already exists")
        except Exception as e:
            print(f"⚠ Warning: Could not check/add 'parsed_data' column: {e}")
        
        # 检查并添加 crawler_config_snapshot 列（如果不存在）
        try:
            cursor.execute("""
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_NAME = 'crawler_batches' 
                AND COLUMN_NAME = 'crawler_config_snapshot'
            """)
            if not cursor.fetchone():
                print("Adding 'crawler_config_snapshot' column to 'crawler_batches' table...")
                cursor.execute("""
                    ALTER TABLE `crawler_batches` 
                    ADD COLUMN `crawler_config_snapshot` JSON DEFAULT NULL COMMENT '爬虫配置快照（用于快速创建新批次）' 
                    AFTER `parsed_data`
                """)
                print("✓ Column 'crawler_config_snapshot' added successfully")
            else:
                print("✓ Column 'crawler_config_snapshot' already exists")
        except Exception as e:
            print(f"⚠ Warning: Could not check/add 'crawler_config_snapshot' column: {e}")
        
        cursor.close()
        conn.close()  # 归还连接到连接池
        
    except Exception as e:
        print(f"✗ Error creating tables: {e}")
        if conn:
            conn.close()  # 确保连接被归还
        raise

def init_redis(config: dict) -> Tuple[bool, Optional[str]]:
    """
    初始化Redis连接
    
    Returns:
        (success: bool, error_message: Optional[str])
    """
    global redis_client, redis_config
    
    redis_config = config.get('redis', {})
    
    if not redis_config.get('enabled', False):
        print("Redis is disabled in config")
        return True, None
    
    try:
        import redis
    except ImportError:
        error_msg = "redis is not installed. Install it with: pip install redis"
        print(f"✗ {error_msg}")
        return False, error_msg
    
    try:
        host = redis_config.get('host', 'localhost')
        port = redis_config.get('port', 6379)
        password = redis_config.get('password', '')
        db = redis_config.get('db', 0)
        
        print(f"Connecting to Redis at {host}:{port}...")
        
        # 创建Redis连接
        redis_client = redis.Redis(
            host=host,
            port=port,
            password=password if password else None,
            db=db,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5
        )
        
        # 测试连接
        redis_client.ping()
        
        print(f"✓ Redis connected successfully (db={db})")
        
        return True, None
        
    except redis.ConnectionError as e:
        error_msg = f"Redis connection error: {e}"
        print(f"✗ {error_msg}")
        return False, error_msg
    except Exception as e:
        error_msg = f"Redis initialization error: {e}"
        print(f"✗ {error_msg}")
        return False, error_msg

def check_connections() -> Tuple[bool, bool]:
    """
    检查MySQL和Redis连接状态
    
    Returns:
        (mysql_ok: bool, redis_ok: bool)
    """
    mysql_ok = False
    redis_ok = False
    
    # 检查MySQL连接池
    if mysql_pool:
        conn = None
        try:
            conn = get_mysql_connection()
            if conn:
                cursor = conn.cursor()
                cursor.execute("SELECT 1")
                cursor.close()
                mysql_ok = True
        except:
            mysql_ok = False
        finally:
            if conn:
                conn.close()  # 归还到连接池
    
    # 检查Redis
    if redis_client:
        try:
            redis_client.ping()
            redis_ok = True
        except:
            redis_ok = False
    
    return mysql_ok, redis_ok

def get_mysql_connection():
    """
    从连接池获取MySQL连接
    
    Returns:
        MySQL连接对象，使用完毕后需要调用 close() 归还到连接池
        如果MySQL未启用或连接池不可用则返回None
    """
    global mysql_pool, mysql_config
    
    if not mysql_config or not mysql_config.get('enabled', False):
        return None
    
    if mysql_pool is None:
        print("[MySQL Pool] Connection pool is not initialized")
        return None
    
    try:
        # 从连接池获取连接
        # DBUtils 的 PooledDB 会自动：
        # 1. 检查连接是否有效（如果 ping=1）
        # 2. 如果连接失效，自动创建新连接
        # 3. 管理连接的生命周期
        conn = mysql_pool.connection()
        return conn
        
    except Exception as e:
        print(f"[MySQL Pool] Error getting connection from pool: {e}")
        import traceback
        traceback.print_exc()
        return None

def get_redis_client():
    """获取Redis客户端"""
    return redis_client

# ==================== OAuth 配置缓存（使用 Redis）====================

def save_oauth_config(state: str, config: dict, ttl: int = 600) -> bool:
    """
    保存 OAuth 配置到 Redis
    ttl: 过期时间（秒），默认 10 分钟；如果为 None，则永不过期
    """
    try:
        if not redis_client:
            print("[OAuth Cache] Redis not available, cannot save OAuth config")
            return False
        
        import json
        key = f"oauth:config:{state}"
        value = json.dumps(config)
        
        if ttl is None:
            # 永不过期
            redis_client.set(key, value)
            print(f"[OAuth Cache] Saved OAuth config for state: {state[:20]}... (永不过期)")
        else:
            # 设置过期时间
            redis_client.setex(key, ttl, value)
            print(f"[OAuth Cache] Saved OAuth config for state: {state[:20]}... (TTL: {ttl}s)")
        
        return True
    except Exception as e:
        print(f"[OAuth Cache] Error saving OAuth config: {e}")
        import traceback
        traceback.print_exc()
        return False

def get_oauth_config(state: str) -> Optional[dict]:
    """从 Redis 获取 OAuth 配置"""
    try:
        if not redis_client:
            print("[OAuth Cache] Redis not available, cannot get OAuth config")
            return None
        
        import json
        key = f"oauth:config:{state}"
        value = redis_client.get(key)
        
        if value:
            # 处理 bytes 或 str 类型
            if isinstance(value, bytes):
                value = value.decode('utf-8')
            config = json.loads(value)
            print(f"[OAuth Cache] Retrieved OAuth config for state: {state[:20]}...")
            return config
        else:
            print(f"[OAuth Cache] No OAuth config found for state: {state[:20]}...")
            return None
    except Exception as e:
        print(f"[OAuth Cache] Error getting OAuth config: {e}")
        import traceback
        traceback.print_exc()
        return None

def delete_oauth_config(state: str) -> bool:
    """删除 OAuth 配置"""
    try:
        if not redis_client:
            return False
        
        key = f"oauth:config:{state}"
        deleted = redis_client.delete(key)
        if deleted:
            print(f"[OAuth Cache] Deleted OAuth config for state: {state[:20]}...")
        return deleted > 0
    except Exception as e:
        print(f"[OAuth Cache] Error deleting OAuth config: {e}")
        return False

# ==================== OAuth Token 管理（使用 Redis）====================

def get_oauth_token(mcp_url: str) -> Optional[dict]:
    """从 Redis 获取 OAuth token"""
    try:
        if not redis_client:
            print("[OAuth Token] Redis not available, cannot get token")
            return None
        
        import json
        key = f"oauth:token:{mcp_url}"
        value = redis_client.get(key)
        
        if value:
            # 处理 bytes 或 str 类型
            if isinstance(value, bytes):
                value = value.decode('utf-8')
            token_info = json.loads(value)
            print(f"[OAuth Token] Retrieved token for MCP: {mcp_url[:50]}...")
            return token_info
        else:
            print(f"[OAuth Token] No token found for MCP: {mcp_url[:50]}...")
            return None
    except Exception as e:
        print(f"[OAuth Token] Error getting token: {e}")
        import traceback
        traceback.print_exc()
        return None

def save_oauth_token(mcp_url: str, token_info: dict) -> bool:
    """保存 OAuth token 到 Redis 和 MySQL"""
    try:
        # 保存到 Redis
        if redis_client:
            import json
            key = f"oauth:token:{mcp_url}"
            value = json.dumps(token_info)
            redis_client.set(key, value)  # 永不过期
            print(f"[OAuth Token] Saved token to Redis for MCP: {mcp_url[:50]}...")
        
        # 保存到 MySQL
        client_id = token_info.get('client_id')
        if client_id and mysql_pool:
            try:
                conn = mysql_pool.connection()
                cursor = conn.cursor()
                
                access_token = token_info.get('access_token')
                refresh_token = token_info.get('refresh_token')
                token_type = token_info.get('token_type', 'bearer')
                expires_in = token_info.get('expires_in')
                expires_at = token_info.get('expires_at')
                scope = token_info.get('scope', '')
                
                # 使用 INSERT ... ON DUPLICATE KEY UPDATE 实现 upsert
                sql = """
                INSERT INTO `oauth_tokens` 
                (`client_id`, `access_token`, `refresh_token`, `token_type`, `expires_in`, `expires_at`, `scope`, `mcp_url`)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    `access_token` = VALUES(`access_token`),
                    `refresh_token` = VALUES(`refresh_token`),
                    `token_type` = VALUES(`token_type`),
                    `expires_in` = VALUES(`expires_in`),
                    `expires_at` = VALUES(`expires_at`),
                    `scope` = VALUES(`scope`),
                    `mcp_url` = VALUES(`mcp_url`),
                    `updated_at` = CURRENT_TIMESTAMP
                """
                cursor.execute(sql, (
                    client_id,
                    access_token,
                    refresh_token,
                    token_type,
                    expires_in,
                    expires_at,
                    scope,
                    mcp_url
                ))
                conn.commit()
                cursor.close()
                conn.close()
                print(f"[OAuth Token] Saved token to MySQL for client_id: {client_id[:10]}...")
            except Exception as e:
                print(f"[OAuth Token] Error saving token to MySQL: {e}")
                import traceback
                traceback.print_exc()
        
        return True
    except Exception as e:
        print(f"[OAuth Token] Error saving token: {e}")
        return False

def is_token_expired(token_info: dict) -> bool:
    """检查 token 是否过期"""
    if not token_info:
        return True
    
    expires_at = token_info.get('expires_at')
    if not expires_at:
        return False  # 没有过期时间，认为永不过期
    
    import time
    return time.time() >= expires_at

def refresh_oauth_token(mcp_url: str, token_info: dict, oauth_config: dict) -> Optional[dict]:
    """刷新 OAuth token（通用，支持所有 MCP 服务器）"""
    try:
        import requests
        import time
        
        refresh_token = token_info.get('refresh_token')
        if not refresh_token:
            print(f"[OAuth Token] No refresh_token available for {mcp_url[:50]}...")
            return None
        
        resource = oauth_config.get('resource')
        # 对于 Notion，使用专用模块
        is_notion = resource and 'mcp.notion.com' in resource
        if is_notion:
            try:
                # 从 token_info 中获取 client_id
                client_id = token_info.get('client_id')
                
                # 动态导入 config（避免循环依赖）
                import sys
                from pathlib import Path
                config_path = Path(__file__).parent.parent / 'config.yaml'
                import yaml
                with open(config_path, 'r', encoding='utf-8') as f:
                    app_config = yaml.safe_load(f)
                
                from mcp_server.well_known.notion import refresh_notion_token
                # 传递 client_id 以便从数据库读取注册信息
                new_token_info = refresh_notion_token(app_config, refresh_token, mcp_url, client_id)
                if new_token_info:
                    print(f"[OAuth Token] ✅ Notion token refreshed successfully")
                return new_token_info
            except Exception as e:
                print(f"[OAuth Token] ⚠️ Notion-specific refresh failed, falling back to generic: {e}")
                # 如果 Notion 专用刷新失败，继续使用通用逻辑
        
        # 通用 token 刷新逻辑
        token_endpoint = oauth_config.get('token_endpoint')
        client_id = oauth_config.get('client_id')
        client_secret = oauth_config.get('client_secret', '')
        token_endpoint_auth_methods = oauth_config.get('token_endpoint_auth_methods_supported', ['none'])
        
        if not token_endpoint:
            print(f"[OAuth Token] No token_endpoint in config")
            return None
        
        print(f"[OAuth Token] Refreshing token for {mcp_url[:50]}...")
        
        headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
        }
        
        payload = {
            'grant_type': 'refresh_token',
            'refresh_token': refresh_token,
            'client_id': client_id,
        }
        
        # 根据认证方式选择
        if 'client_secret_basic' in token_endpoint_auth_methods and client_secret:
            import base64
            auth_string = f"{client_id}:{client_secret}"
            auth_bytes = auth_string.encode('utf-8')
            auth_b64 = base64.b64encode(auth_bytes).decode('utf-8')
            headers['Authorization'] = f'Basic {auth_b64}'
        elif 'client_secret_post' in token_endpoint_auth_methods and client_secret:
            payload['client_secret'] = client_secret
        
        if resource:
            payload['resource'] = resource
        
        response = requests.post(token_endpoint, data=payload, headers=headers, timeout=30)
        
        if not response.ok:
            print(f"[OAuth Token] ❌ Token refresh failed: {response.status_code}")
            return None
        
        new_token_data = response.json()
        new_access_token = new_token_data.get('access_token')
        new_refresh_token = new_token_data.get('refresh_token', refresh_token)  # 如果没有新的，使用旧的
        expires_in = new_token_data.get('expires_in')
        
        if not new_access_token:
            print(f"[OAuth Token] ❌ No access_token in refresh response")
            return None
        
        # 保留原有的client_id和其他字段
        client_id = token_info.get('client_id')
        new_token_info = {
            'client_id': client_id,  # 保留client_id
            'access_token': new_access_token,
            'refresh_token': new_refresh_token,
            'token_type': new_token_data.get('token_type', 'bearer'),
            'expires_in': expires_in,
            'expires_at': int(time.time()) + expires_in if expires_in else None,
            'scope': new_token_data.get('scope', ''),
            'mcp_url': mcp_url,
        }
        
        # 保存新 token（会同时保存到Redis和MySQL）
        save_oauth_token(mcp_url, new_token_info)
        print(f"[OAuth Token] ✅ Token refreshed successfully")
        
        return new_token_info
        
    except Exception as e:
        print(f"[OAuth Token] ❌ Error refreshing token: {e}")
        import traceback
        traceback.print_exc()
        return None

