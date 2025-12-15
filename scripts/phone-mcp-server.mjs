import http from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const PHONE_SERVICE_URL = process.env.PHONE_SERVICE_URL || 'http://127.0.0.1:3010';
const PORT = Number.parseInt(process.env.PHONE_MCP_PORT || '18060', 10);
const HOST = process.env.PHONE_MCP_HOST || '127.0.0.1';

function jsonToolResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: false,
  };
}

function pickStatus(raw, includeScreenshot) {
  if (!raw || typeof raw !== 'object') return raw;
  const {
    task_id,
    state,
    step_count,
    model,
    current_app,
    thinking,
    action_text,
    action,
    pending,
    final_message,
    error,
    screenshot_meta,
    screenshot,
  } = raw;

  return {
    task_id,
    state,
    step_count,
    model,
    current_app,
    thinking,
    action_text,
    action,
    pending,
    final_message,
    error,
    screenshot_meta,
    ...(includeScreenshot ? { screenshot } : {}),
  };
}

async function httpJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`phone_service HTTP ${res.status}: ${text.slice(0, 2000)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`phone_service returned non-JSON: ${text.slice(0, 2000)}`);
  }
}

const mcp = new McpServer(
  { name: 'phone-service-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

mcp.registerTool(
  'phone.start_task',
  {
    description: 'Start a phone automation task (runs on phone_service + autoglm-phone).',
    inputSchema: z.object({
      task: z.string().min(1),
      device_id: z.string().optional(),
      lang: z.enum(['cn', 'en']).optional(),
      include_screenshot: z.boolean().optional().default(false),
    }),
  },
  async (args) => {
    const payload = {
      task: args.task,
      device_id: args.device_id,
      lang: args.lang || 'cn',
    };
    const created = await httpJson(`${PHONE_SERVICE_URL}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const taskId = created.task_id;
    const status = await httpJson(`${PHONE_SERVICE_URL}/tasks/${encodeURIComponent(taskId)}`);
    return jsonToolResult(pickStatus(status, args.include_screenshot));
  }
);

mcp.registerTool(
  'phone.status',
  {
    description: 'Get current task status from phone_service.',
    inputSchema: z.object({
      task_id: z.string().min(1),
      include_screenshot: z.boolean().optional().default(false),
    }),
  },
  async (args) => {
    const status = await httpJson(`${PHONE_SERVICE_URL}/tasks/${encodeURIComponent(args.task_id)}`);
    return jsonToolResult(pickStatus(status, args.include_screenshot));
  }
);

mcp.registerTool(
  'phone.step',
  {
    description: 'Run one automation step for a task.',
    inputSchema: z.object({
      task_id: z.string().min(1),
      include_screenshot: z.boolean().optional().default(false),
    }),
  },
  async (args) => {
    const status = await httpJson(
      `${PHONE_SERVICE_URL}/tasks/${encodeURIComponent(args.task_id)}/step`,
      { method: 'POST' }
    );
    return jsonToolResult(pickStatus(status, args.include_screenshot));
  }
);

mcp.registerTool(
  'phone.run',
  {
    description:
      'Run multiple steps until FINISHED / WAIT_CONFIRM / WAIT_TAKEOVER / ERROR, or max_steps reached.',
    inputSchema: z.object({
      task_id: z.string().min(1),
      max_steps: z.number().int().min(1).max(200).optional().default(20),
      step_delay_ms: z.number().int().min(0).max(5000).optional().default(400),
      include_screenshot: z.boolean().optional().default(false),
    }),
  },
  async (args) => {
    let last = await httpJson(`${PHONE_SERVICE_URL}/tasks/${encodeURIComponent(args.task_id)}`);
    for (let i = 0; i < args.max_steps; i += 1) {
      if (last?.state && last.state !== 'RUNNING') break;
      last = await httpJson(`${PHONE_SERVICE_URL}/tasks/${encodeURIComponent(args.task_id)}/step`, {
        method: 'POST',
      });
      if (args.step_delay_ms > 0) {
        await new Promise((r) => setTimeout(r, args.step_delay_ms));
      }
    }
    return jsonToolResult(pickStatus(last, args.include_screenshot));
  }
);

mcp.registerTool(
  'phone.confirm',
  {
    description: 'Confirm or cancel a sensitive operation for a task (WAIT_CONFIRM).',
    inputSchema: z.object({
      task_id: z.string().min(1),
      approved: z.boolean(),
      include_screenshot: z.boolean().optional().default(false),
    }),
  },
  async (args) => {
    const status = await httpJson(
      `${PHONE_SERVICE_URL}/tasks/${encodeURIComponent(args.task_id)}/confirm`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: args.approved }),
      }
    );
    return jsonToolResult(pickStatus(status, args.include_screenshot));
  }
);

mcp.registerTool(
  'phone.takeover_done',
  {
    description: 'Notify phone_service that manual takeover is completed (WAIT_TAKEOVER).',
    inputSchema: z.object({
      task_id: z.string().min(1),
      include_screenshot: z.boolean().optional().default(false),
    }),
  },
  async (args) => {
    const status = await httpJson(
      `${PHONE_SERVICE_URL}/tasks/${encodeURIComponent(args.task_id)}/takeover_done`,
      { method: 'POST' }
    );
    return jsonToolResult(pickStatus(status, args.include_screenshot));
  }
);

mcp.registerTool(
  'phone.cancel',
  {
    description: 'Cancel a running task.',
    inputSchema: z.object({
      task_id: z.string().min(1),
      include_screenshot: z.boolean().optional().default(false),
    }),
  },
  async (args) => {
    const status = await httpJson(`${PHONE_SERVICE_URL}/tasks/${encodeURIComponent(args.task_id)}/cancel`, {
      method: 'POST',
    });
    return jsonToolResult(pickStatus(status, args.include_screenshot));
  }
);

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // stateless: simplest + supports multiple clients
  enableJsonResponse: true,
});

await mcp.connect(transport);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/mcp') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }
  await transport.handleRequest(req, res);
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[phone-mcp] listening on http://${HOST}:${PORT}/mcp`);
  // eslint-disable-next-line no-console
  console.log(`[phone-mcp] forwarding to PHONE_SERVICE_URL=${PHONE_SERVICE_URL}`);
});

