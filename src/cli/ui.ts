/**
 * UI Command Handler
 * swixter ui [--port <port>]
 */

import pc from "picocolors";
import { startServer } from "../server/index.js";

/**
 * Handle ui command
 */
export async function handleUiCommand(args?: string[]): Promise<void> {
  const port = getPortFromArgs(args);

  try {
    const server = await startServer(port);

    // Handle graceful shutdown on Ctrl+C
    process.on("SIGINT", () => {
      console.log();
      console.log(pc.dim("Shutting down..."));
      server.close(() => {
        process.exit(0);
      });
    });

    // Keep process alive
    process.stdin.resume();
  } catch (error) {
    console.error(pc.red(`Failed to start server: ${error}`));
    process.exit(1);
  }
}

/**
 * Parse port from arguments
 */
function getPortFromArgs(args?: string[]): number | undefined {
  if (!args || args.length === 0) {
    return undefined;
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--port" || arg === "-p") {
      const portStr = args[i + 1];
      if (!portStr) {
        console.error(pc.red("Error: --port requires a value"));
        process.exit(1);
      }

      const port = parseInt(portStr, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(pc.red("Error: Invalid port number"));
        process.exit(1);
      }

      return port;
    }
  }

  return undefined;
}
