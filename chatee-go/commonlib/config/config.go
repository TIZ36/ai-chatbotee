package config

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/spf13/viper"
)

// =============================================================================
// Configuration Types
// =============================================================================

// ServiceConfig configures the service.
type ServiceConfig struct {
	Name        string `json:"name" mapstructure:"name"`
	Version     string `json:"version" mapstructure:"version"`
	Environment string `json:"environment" mapstructure:"environment"` // dev, staging, prod
	NodeID      string `json:"node_id" mapstructure:"node_id"`
}

// MySQLConfig configures MySQL.
type MySQLConfig struct {
	Host            string        `json:"host" mapstructure:"host"`
	Port            int           `json:"port" mapstructure:"port"`
	User            string        `json:"user" mapstructure:"user"`
	Password        string        `json:"password" mapstructure:"password"`
	Database        string        `json:"database" mapstructure:"database"`
	MaxOpenConns    int           `json:"max_open_conns" mapstructure:"max_open_conns"`
	MaxIdleConns    int           `json:"max_idle_conns" mapstructure:"max_idle_conns"`
	ConnMaxLifetime time.Duration `json:"conn_max_lifetime" mapstructure:"conn_max_lifetime"`
}

// RedisConfig configures Redis.
type RedisConfig struct {
	Host         string `json:"host" mapstructure:"host"`
	Port         int    `json:"port" mapstructure:"port"`
	Password     string `json:"password" mapstructure:"password"`
	DB           int    `json:"db" mapstructure:"db"`
	PoolSize     int    `json:"pool_size" mapstructure:"pool_size"`
	MinIdleConns int    `json:"min_idle_conns" mapstructure:"min_idle_conns"`
}

// HBaseConfig configures HBase.
type HBaseConfig struct {
	ZookeeperQuorum string `json:"zookeeper_quorum" mapstructure:"zookeeper_quorum"`
	ZookeeperPort   int    `json:"zookeeper_port" mapstructure:"zookeeper_port"`
	TablePrefix     string `json:"table_prefix" mapstructure:"table_prefix"`
}

type ThriftHbaseConfig struct {
	Host              string            `json:"host" mapstructure:"host"`
	Namespace         string            `json:"namespace" mapstructure:"namespace"`
	ClientType        int64             `json:"client_type" mapstructure:"client_type"`
	HbasePoolConfig   HbasePoolConfig   `json:"hbase_pool_config" mapstructure:"hbase_pool_config"`
	HbaseClientConfig HbaseClientConfig `json:"hbase_client_config" mapstructure:"hbase_client_config"`
}

type ZookeeperHbaseConfig struct {
	ZkHosts           string            `json:"zk_hosts" mapstructure:"zk_hosts"`
	Namespace         string            `json:"namespace" mapstructure:"namespace"`
	ClientType        string            `json:"client_type" mapstructure:"client_type"`
	HbasePoolConfig   HbasePoolConfig   `json:"hbase_pool_config" mapstructure:"hbase_pool_config"`
	HbaseClientConfig HbaseClientConfig `json:"hbase_client_config" mapstructure:"hbase_client_config"`
}

type HbasePoolConfig struct {
	InitSize    int           `json:"init_size" mapstructure:"init_size"`
	MaxSize     int           `json:"max_size" mapstructure:"max_size"`
	IdleSize    int           `json:"idle_size" mapstructure:"idle_size"`
	IdleTimeout time.Duration `json:"idle_timeout" mapstructure:"idle_timeout"`
}

type HbaseClientConfig struct {
	ConnectTimeout int64           `json:"connect_timeout" mapstructure:"connect_timeout"`
	SocketTimeout  int64           `json:"socket_timeout" mapstructure:"socket_timeout"`
	MaxFrameSize   int32           `json:"max_frame_size" mapstructure:"max_frame_size"`
	Credential     HabseCredential `json:"credential" mapstructure:"credential"`
}

type HabseCredential struct {
	User string `json:"user" mapstructure:"user"`
	Pass string `json:"pass" mapstructure:"pass"`
}

// ChromaConfig configures ChromaDB.
type ChromaConfig struct {
	Host       string `json:"host" mapstructure:"host"`
	Port       int    `json:"port" mapstructure:"port"`
	Collection string `json:"collection" mapstructure:"collection"`
}

// GRPCConfig configures gRPC server.
type GRPCConfig struct {
	Host             string        `json:"host" mapstructure:"host"`
	Port             int           `json:"port" mapstructure:"port"`
	MaxRecvMsgSize   int           `json:"max_recv_msg_size" mapstructure:"max_recv_msg_size"`
	MaxSendMsgSize   int           `json:"max_send_msg_size" mapstructure:"max_send_msg_size"`
	KeepaliveTime    time.Duration `json:"keepalive_time" mapstructure:"keepalive_time"`
	KeepaliveTimeout time.Duration `json:"keepalive_timeout" mapstructure:"keepalive_timeout"`
}

// HTTPConfig configures HTTP server.
type HTTPConfig struct {
	Host         string        `json:"host" mapstructure:"host"`
	Port         int           `json:"port" mapstructure:"port"`
	ReadTimeout  time.Duration `json:"read_timeout" mapstructure:"read_timeout"`
	WriteTimeout time.Duration `json:"write_timeout" mapstructure:"write_timeout"`
	IdleTimeout  time.Duration `json:"idle_timeout" mapstructure:"idle_timeout"`
	EnableCORS   bool          `json:"enable_cors" mapstructure:"enable_cors"`
	CORSOrigins  []string      `json:"cors_origins" mapstructure:"cors_origins"`
}

// WebSocketConfig configures WebSocket.
type WebSocketConfig struct {
	ReadBufferSize  int           `json:"read_buffer_size" mapstructure:"read_buffer_size"`
	WriteBufferSize int           `json:"write_buffer_size" mapstructure:"write_buffer_size"`
	PingInterval    time.Duration `json:"ping_interval" mapstructure:"ping_interval"`
	PongWait        time.Duration `json:"pong_wait" mapstructure:"pong_wait"`
	MaxMessageSize  int64         `json:"max_message_size" mapstructure:"max_message_size"`
	AllowedOrigins  []string      `json:"allowed_origins" mapstructure:"allowed_origins"` // List of allowed origins for WebSocket connections
}

// LLMProviderConfig configures a single LLM provider.
type LLMProviderConfig struct {
	Name    string `json:"name" mapstructure:"name"`
	Type    string `json:"type" mapstructure:"type"` // openai, anthropic, deepseek
	APIKey  string `json:"api_key" mapstructure:"api_key"`
	BaseURL string `json:"base_url" mapstructure:"base_url"`
	Enabled bool   `json:"enabled" mapstructure:"enabled"`
}

// LLMConfig configures LLM providers.
type LLMConfig struct {
	DefaultProvider string              `json:"default_provider" mapstructure:"default_provider"`
	Providers       []LLMProviderConfig `json:"providers" mapstructure:"providers"`
}

// MCPConfig configures MCP.
type MCPConfig struct {
	ServersDir     string        `json:"servers_dir" mapstructure:"servers_dir"`
	DefaultTimeout time.Duration `json:"default_timeout" mapstructure:"default_timeout"`
}

// LogConfig configures logging.
type LogConfig struct {
	Level      string `json:"level" mapstructure:"level"`   // debug, info, warn, error
	Format     string `json:"format" mapstructure:"format"` // json, console
	OutputPath string `json:"output_path" mapstructure:"output_path"`
	MaxSize    int    `json:"max_size" mapstructure:"max_size"` // MB
	MaxBackups int    `json:"max_backups" mapstructure:"max_backups"`
	MaxAge     int    `json:"max_age" mapstructure:"max_age"` // days
}

// ConnectionConfig configures connection management.
type ConnectionConfig struct {
	EnableDistributed     bool          `json:"enable_distributed" mapstructure:"enable_distributed"`
	NodeID                string        `json:"node_id" mapstructure:"node_id"`
	HeartbeatInterval     time.Duration `json:"heartbeat_interval" mapstructure:"heartbeat_interval"`
	HeartbeatTimeout      time.Duration `json:"heartbeat_timeout" mapstructure:"heartbeat_timeout"`
	NodeHeartbeatInterval time.Duration `json:"node_heartbeat_interval" mapstructure:"node_heartbeat_interval"`
	NodeHeartbeatTimeout  time.Duration `json:"node_heartbeat_timeout" mapstructure:"node_heartbeat_timeout"`
	LoadBalancingStrategy string        `json:"load_balancing_strategy" mapstructure:"load_balancing_strategy"` // round_robin, least_connections, user_affinity
}

// Config holds all configuration.
type Config struct {
	Service    ServiceConfig     `json:"service" mapstructure:"service"`
	MySQL      MySQLConfig       `json:"mysql" mapstructure:"mysql"`
	Redis      RedisConfig       `json:"redis" mapstructure:"redis"`
	HBase      ThriftHbaseConfig `json:"hbase" mapstructure:"hbase"`
	Chroma     ChromaConfig      `json:"chroma" mapstructure:"chroma"`
	GRPC       GRPCConfig        `json:"grpc" mapstructure:"grpc"`
	HTTP       HTTPConfig        `json:"http" mapstructure:"http"`
	WebSocket  WebSocketConfig   `json:"websocket" mapstructure:"websocket"`
	LLM        LLMConfig         `json:"llm" mapstructure:"llm"`
	MCP        MCPConfig         `json:"mcp" mapstructure:"mcp"`
	Log        LogConfig         `json:"log" mapstructure:"log"`
	Connection ConnectionConfig  `json:"connection" mapstructure:"connection"`
}

// =============================================================================
// Configuration Loading
// =============================================================================

// Load loads configuration from files and environment.
func Load(configPath string) (*Config, error) {
	v := viper.New()

	// Set defaults
	setDefaults(v)

	// Read config file
	if configPath != "" {
		v.SetConfigFile(configPath)
	} else {
		v.SetConfigName("config")
		v.SetConfigType("yaml")
		v.AddConfigPath(".")
		v.AddConfigPath("./configs")
		v.AddConfigPath("/etc/chatee")
	}

	// Read environment variables
	v.SetEnvPrefix("CHATEE")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	// Read config file (optional)
	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("failed to read config: %w", err)
		}
		// Config file not found, use defaults + env vars
	}

	var config Config
	if err := v.Unmarshal(&config); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	// Override with environment variables
	overrideFromEnv(&config)

	return &config, nil
}

// setDefaults sets default values.
func setDefaults(v *viper.Viper) {
	// Service
	v.SetDefault("service.name", "chatee")
	v.SetDefault("service.version", "1.0.0")
	v.SetDefault("service.environment", "dev")

	// MySQL
	v.SetDefault("mysql.host", "localhost")
	v.SetDefault("mysql.port", 3306)
	v.SetDefault("mysql.user", "root")
	v.SetDefault("mysql.database", "chatee")
	v.SetDefault("mysql.max_open_conns", 100)
	v.SetDefault("mysql.max_idle_conns", 10)
	v.SetDefault("mysql.conn_max_lifetime", "1h")

	// Redis
	v.SetDefault("redis.host", "localhost")
	v.SetDefault("redis.port", 6379)
	v.SetDefault("redis.db", 0)
	v.SetDefault("redis.pool_size", 100)

	// gRPC
	v.SetDefault("grpc.host", "0.0.0.0")
	v.SetDefault("grpc.port", 50051)
	v.SetDefault("grpc.max_recv_msg_size", 16*1024*1024) // 16MB
	v.SetDefault("grpc.max_send_msg_size", 16*1024*1024) // 16MB
	v.SetDefault("grpc.keepalive_time", "30s")
	v.SetDefault("grpc.keepalive_timeout", "10s")

	// HTTP
	v.SetDefault("http.host", "0.0.0.0")
	v.SetDefault("http.port", 8080)
	v.SetDefault("http.read_timeout", "30s")
	v.SetDefault("http.write_timeout", "30s")
	v.SetDefault("http.idle_timeout", "120s")
	v.SetDefault("http.enable_cors", true)

	// WebSocket
	v.SetDefault("websocket.read_buffer_size", 1024)
	v.SetDefault("websocket.write_buffer_size", 1024)
	v.SetDefault("websocket.ping_interval", "30s")
	v.SetDefault("websocket.pong_wait", "60s")
	v.SetDefault("websocket.max_message_size", 32*1024) // 32KB

	// MCP
	v.SetDefault("mcp.default_timeout", "30s")

	// Log
	v.SetDefault("log.level", "info")
	v.SetDefault("log.format", "json")
	v.SetDefault("log.max_size", 100)
	v.SetDefault("log.max_backups", 3)
	v.SetDefault("log.max_age", 30)

	// Connection
	v.SetDefault("connection.enable_distributed", false)
	v.SetDefault("connection.node_id", "")
	v.SetDefault("connection.heartbeat_interval", "30s")
	v.SetDefault("connection.heartbeat_timeout", "60s")
	v.SetDefault("connection.node_heartbeat_interval", "10s")
	v.SetDefault("connection.node_heartbeat_timeout", "30s")
	v.SetDefault("connection.load_balancing_strategy", "least_connections")
}

// overrideFromEnv overrides config from environment variables.
func overrideFromEnv(config *Config) {
	// MySQL password from env
	if pw := os.Getenv("CHATEE_MYSQL_PASSWORD"); pw != "" {
		config.MySQL.Password = pw
	}

	// Redis password from env
	if pw := os.Getenv("CHATEE_REDIS_PASSWORD"); pw != "" {
		config.Redis.Password = pw
	}

	// LLM API keys from env
	for i := range config.LLM.Providers {
		envKey := fmt.Sprintf("CHATEE_LLM_%s_API_KEY", strings.ToUpper(config.LLM.Providers[i].Name))
		if key := os.Getenv(envKey); key != "" {
			config.LLM.Providers[i].APIKey = key
		}
	}
}

// =============================================================================
// Validation
// =============================================================================

// Validate validates the configuration.
func (c *Config) Validate() error {
	// Basic validation
	if c.Service.Name == "" {
		return fmt.Errorf("service.name is required")
	}

	// MySQL validation
	if c.MySQL.Host == "" {
		return fmt.Errorf("mysql.host is required")
	}
	if c.MySQL.Port <= 0 {
		return fmt.Errorf("mysql.port must be positive")
	}

	// Redis validation
	if c.Redis.Host == "" {
		return fmt.Errorf("redis.host is required")
	}

	// gRPC validation
	if c.GRPC.Port <= 0 {
		return fmt.Errorf("grpc.port must be positive")
	}

	// HTTP validation
	if c.HTTP.Port <= 0 {
		return fmt.Errorf("http.port must be positive")
	}

	return nil
}

// =============================================================================
// Helper Functions
// =============================================================================

// IsDev returns true if in development environment.
func (c *Config) IsDev() bool {
	return c.Service.Environment == "dev" || c.Service.Environment == "development"
}

// IsProd returns true if in production environment.
func (c *Config) IsProd() bool {
	return c.Service.Environment == "prod" || c.Service.Environment == "production"
}

// GetGRPCAddr returns the gRPC address.
func (c *Config) GetGRPCAddr() string {
	return fmt.Sprintf("%s:%d", c.GRPC.Host, c.GRPC.Port)
}

// GetHTTPAddr returns the HTTP address.
func (c *Config) GetHTTPAddr() string {
	return fmt.Sprintf("%s:%d", c.HTTP.Host, c.HTTP.Port)
}
