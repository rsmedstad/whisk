// Cloudflare Pages Function at /mcp (outside functions/api/ so session
// _middleware.ts does not apply). Auth is WHISK_MCP_TOKEN Bearer only.

import { handleMcp, type McpEnv } from "./lib/mcp-handler";

export const onRequest: PagesFunction<McpEnv> = async (context) => {
  return handleMcp(context.request, context.env);
};
