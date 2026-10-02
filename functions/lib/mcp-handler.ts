// Minimal Streamable HTTP / JSON-RPC MCP endpoint for Whisk.
// POST /mcp — initialize, tools/list, tools/call, ping; notifications are no-ops.
// Auth: Authorization Bearer WHISK_MCP_TOKEN only (never APP_SECRET / session).
// No Access-Control-Allow-Origin: * on MCP responses.

import { authorizeMcp, type McpAuthEnv } from "./mcp-auth";
import { callTool, TOOL_DEFS, type McpToolEnv } from "./mcp-tools";

export type McpEnv = McpAuthEnv & McpToolEnv;

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "whisk-mcp", version: "0.1.0" };

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

function mcpJson(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  // Explicitly do NOT set Access-Control-Allow-Origin.
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function rpcResult(id: JsonRpcId, result: unknown): unknown {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: JsonRpcId, code: number, message: string): unknown {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export async function handleMcp(req: Request, env: McpEnv): Promise<Response> {
  if (req.method === "GET") {
    const auth = await authorizeMcp(req, env);
    if (!auth.ok) return mcpJson({ error: auth.error }, auth.status);
    return mcpJson({
      ok: true,
      transport: "streamable-http",
      server: SERVER_INFO,
      protocolVersion: PROTOCOL_VERSION,
    });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        Allow: "GET, POST, OPTIONS",
        "cache-control": "no-store",
      },
    });
  }

  if (req.method !== "POST") {
    return mcpJson({ error: "method not allowed" }, 405);
  }

  const auth = await authorizeMcp(req, env);
  if (!auth.ok) return mcpJson({ error: auth.error }, auth.status);

  let body: JsonRpcRequest;
  try {
    body = (await req.json()) as JsonRpcRequest;
  } catch {
    return mcpJson(rpcError(null, -32700, "parse error"), 400);
  }

  if (Array.isArray(body)) {
    return mcpJson(rpcError(null, -32600, "batch not supported"), 400);
  }

  const method = typeof body.method === "string" ? body.method : "";
  const id = (body.id ?? null) as JsonRpcId;
  const isNotification =
    body.id === undefined && method.startsWith("notifications/");

  if (method.startsWith("notifications/") || method === "notifications/initialized") {
    return new Response(null, {
      status: 202,
      headers: { "cache-control": "no-store" },
    });
  }

  if (!method) {
    return mcpJson(rpcError(id, -32600, "invalid request"));
  }

  switch (method) {
    case "initialize": {
      const params = (body.params ?? {}) as { protocolVersion?: string };
      const requested = params.protocolVersion || PROTOCOL_VERSION;
      return mcpJson(
        rpcResult(id, {
          protocolVersion:
            requested === "2024-11-05" ? "2024-11-05" : PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        })
      );
    }
    case "ping":
      return mcpJson(rpcResult(id, {}));
    case "tools/list":
      return mcpJson(
        rpcResult(id, {
          tools: TOOL_DEFS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        })
      );
    case "tools/call": {
      const params = (body.params ?? {}) as {
        name?: string;
        arguments?: Record<string, unknown>;
      };
      const name = params.name;
      if (!name || typeof name !== "string") {
        return mcpJson(rpcError(id, -32602, "tool name required"));
      }
      const args =
        params.arguments &&
        typeof params.arguments === "object" &&
        !Array.isArray(params.arguments)
          ? params.arguments
          : {};
      const result = await callTool(name, args, env);
      return mcpJson(rpcResult(id, result));
    }
    default:
      if (isNotification) {
        return new Response(null, {
          status: 202,
          headers: { "cache-control": "no-store" },
        });
      }
      return mcpJson(rpcError(id, -32601, `method not found: ${method}`));
  }
}
