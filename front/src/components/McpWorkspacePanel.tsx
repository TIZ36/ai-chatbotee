/**
 * MCP 工作台：服务器录入与管理
 * 「对话中自动使用 MCP」开关在聊天页顶部 Tab 行（Chaya）
 */

import React from 'react';
import MCPConfig from './MCPConfig';

const McpWorkspacePanel: React.FC = () => {
  return (
    <div className="mcp-workspace-page h-full min-h-0 flex flex-col overflow-hidden bg-[var(--surface-primary)]">
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <MCPConfig />
      </div>
    </div>
  );
};

export default McpWorkspacePanel;
