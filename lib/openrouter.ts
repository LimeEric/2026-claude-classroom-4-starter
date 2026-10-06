import "server-only";

/**
 * A model config for Mastra's model router. The router reads
 * OPENROUTER_API_KEY itself; no AI SDK provider package is involved.
 */
export function openRouterModel(id: string) {
  return {
    id: `openrouter/${id}` as const,
    // OPENROUTER_BASE_URL routes the traffic through a local proxy (mitmproxy
    // in reverse mode, see .env.example). A custom url switches off the
    // router's own key lookup, so hand the key over.
    ...(process.env.OPENROUTER_BASE_URL && {
      url: process.env.OPENROUTER_BASE_URL,
      apiKey: process.env.OPENROUTER_API_KEY,
    }),
  };
}
