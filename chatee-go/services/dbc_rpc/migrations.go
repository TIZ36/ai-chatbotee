package main

import (
	"bytes"
	"embed"
	"fmt"
	"strings"

	"github.com/tiz36/ghbase"

	"chatee-go/commonlib/log"
	"chatee-go/commonlib/pool"
)

//go:embed migrations/mysql/*.sql
var mysqlMigrations embed.FS

// runMigrations 执行所有数据库迁移
func runMigrations(poolMgr *pool.PoolManager, logger log.Logger) error {
	logger.Info("Running database migrations...")

	// Run MySQL migrations
	if err := runMySQLMigrations(poolMgr, logger); err != nil {
		logger.Error("MySQL migrations failed", log.Err(err))
		return err
	}

	// Create HBase tables
	if err := createHBaseTables(poolMgr, logger); err != nil {
		logger.Error("HBase table creation failed", log.Err(err))
		return err
	}

	logger.Info("All migrations completed successfully")
	return nil
}

// runMySQLMigrations 执行 MySQL 迁移脚本
func runMySQLMigrations(poolMgr *pool.PoolManager, logger log.Logger) error {
	logger.Info("Running MySQL migrations...")

	db := poolMgr.GetGORM()
	if db == nil {
		return fmt.Errorf("database connection not available")
	}

	// 读取嵌入的迁移文件
	entries, err := mysqlMigrations.ReadDir("migrations/mysql")
	if err != nil {
		return fmt.Errorf("failed to read migrations directory: %w", err)
	}

	// 按顺序执行 SQL 文件
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			logger.Info("Executing migration", log.String("file", entry.Name()))

			// 读取文件内容
			content, err := mysqlMigrations.ReadFile(fmt.Sprintf("migrations/mysql/%s", entry.Name()))
			if err != nil {
				return fmt.Errorf("failed to read migration file %s: %w", entry.Name(), err)
			}

			// 解析并执行 SQL 语句
			statements := parseSQLStatements(string(content))
			for _, stmt := range statements {
				if err := db.Exec(stmt).Error; err != nil {
					logger.Error("Migration execution failed", log.String("file", entry.Name()), log.Err(err))
					return fmt.Errorf("failed to execute migration %s: %w", entry.Name(), err)
				}
			}

			logger.Info("Migration completed", log.String("file", entry.Name()))
		}
	}

	logger.Info("MySQL migrations completed")
	return nil
}

// createHBaseTables 创建 HBase 表
func createHBaseTables(poolMgr *pool.PoolManager, logger log.Logger) error {
	logger.Info("Creating HBase tables...")

	hbasePool := poolMgr.HBase()
	if hbasePool == nil {
		logger.Warn("HBase pool not available, skipping table creation")
		return nil
	}

	// HBase 表定义
	tables := []struct {
		name           string
		columnFamilies []string
	}{
		{"chatee_threads_metadata", []string{"meta"}},
		{"chatee_threads_messages", []string{"msg"}},
		{"chatee_follow_feed", []string{"feed"}},
		{"chatee_reply_feed", []string{"feed"}},
		{"chatee_chats_metadata", []string{"meta"}},
		{"chatee_chats_inbox", []string{"inbox"}},
	}

	// 创建表
	for _, table := range tables {
		logger.Info("Creating HBase table", log.String("table", table.name))

		if err := ensureHBaseTable(hbasePool, table.name, table.columnFamilies, logger); err != nil {
			logger.Error("Failed to create HBase table", log.String("table", table.name), log.Err(err))
			// 不中断，继续创建其他表
		}
	}

	logger.Info("HBase tables creation completed")
	return nil
}

// ensureHBaseTable 确保 HBase 表存在
func ensureHBaseTable(pool *ghbase.HbaseClientPool, tableName string, columnFamilies []string, logger log.Logger) error {
	// 注意：HBase 表的创建需要通过 HBase Shell 或 Admin API
	// 这里只是记录需要创建的表信息
	logger.Info("HBase table configuration",
		log.String("table", tableName),
		log.String("columnFamilies", strings.Join(columnFamilies, ",")),
		log.String("note", "Please ensure this table exists in HBase"),
	)

	// 如果需要在启动时自动创建表，可以通过以下方式实现：
	// 1. 使用 HBase Shell 脚本（Docker 容器外部）
	// 2. 使用 HBase Admin API（需要额外的 Java 客户端库）
	// 3. 使用 setup 目录中的 init-tables.sh 脚本

	return nil
}

// parseSQLStatements 解析 SQL 文件中的语句
func parseSQLStatements(content string) []string {
	var statements []string
	var buffer bytes.Buffer

	lines := strings.Split(content, "\n")
	for _, line := range lines {
		// 移除行内注释（-- 之后的内容）
		if idx := strings.Index(line, "--"); idx != -1 {
			line = line[:idx]
		}

		trimmed := strings.TrimSpace(line)

		// 跳过空行
		if trimmed == "" {
			continue
		}

		buffer.WriteString(trimmed)
		buffer.WriteString(" ")

		// 如果行以分号结尾，说明一个语句完成
		if strings.HasSuffix(trimmed, ";") {
			stmt := strings.TrimSpace(buffer.String())
			stmt = strings.TrimSuffix(stmt, ";")
			if stmt != "" {
				statements = append(statements, stmt)
			}
			buffer.Reset()
		}
	}

	// 处理剩余的内容
	if buffer.Len() > 0 {
		stmt := strings.TrimSpace(buffer.String())
		stmt = strings.TrimSuffix(stmt, ";")
		if stmt != "" {
			statements = append(statements, stmt)
		}
	}

	return statements
}
