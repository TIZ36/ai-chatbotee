export {};

declare global {
  interface Window {
    /** Electron preload 注入 */
    electronAPI?: {
      // MCP Runner（stdio）
      mcpRunnerStart?: (params: {
        serverId: string;
        command: string;
        args?: string[];
        env?: Record<string, string>;
        cwd?: string;
      }) => Promise<{ success: boolean; error?: string }>;
      mcpRunnerStop?: (params: { serverId: string }) => Promise<{ success: boolean; error?: string }>;
      mcpRunnerListTools?: (params: { serverId: string; forceRefresh?: boolean }) => Promise<{ tools: any[] }>;
      mcpRunnerCallTool?: (params: {
        serverId: string;
        toolName: string;
        args: Record<string, any>;
        timeoutMs?: number;
      }) => Promise<{ result: any; isError?: boolean }>;

      // OAuth（已有）
      mcpOAuthOpenExternal?: (params: { authorizationUrl: string }) => Promise<{ success: boolean }>;
    };
  }
}


