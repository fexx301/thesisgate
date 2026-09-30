// Runs once when the server process starts (Next.js instrumentation hook).
// We use it only to install the Bitget MCP session shutdown handler eagerly: the container sets
// NEXT_MANUAL_SIG_HANDLE=true so Next does not exit on SIGTERM before those sessions are closed, so
// *something* must own the signal from boot. Registering it here (not lazily on the first MCP call)
// means a deploy's graceful `docker stop` always finds a handler and exits cleanly (143) instead of
// being SIGKILLed after the grace period (137) with an MCP session still open against Bitget's per-IP cap.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerMcpShutdownHook } = await import("./server/mcp-client");
  registerMcpShutdownHook();
}
