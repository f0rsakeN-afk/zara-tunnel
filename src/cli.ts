#!/usr/bin/env bun
import { parseArgs } from "util";
import { spawn } from "node:child_process";
import { file, write } from "bun";
import { join } from "node:path";

const { positionals } = parseArgs({
  args: Bun.argv.slice(2),
  strict: false,
});

const command = positionals[0];

// Help command
if (!command || command === "help" || command === "--help" || command === "-h") {
  console.log(`
  \x1b[1m\x1b[35mZARA TUNNEL\x1b[0m - Secure & Fast Tunneling

  \x1b[1mUsage:\x1b[0m
    zara expose [port]      Expose a local HTTP port
    zara tcp [port]         Expose a local TCP port
    zara share [dir]        Share a local directory
    zara relay              Start a relay server
    
  \x1b[1mAgent Options:\x1b[0m
    --name <id>            Request a custom subdomain
    --otp                  Enable One-Time Password
    --cors                 Enable CORS bypass
    --token <secret>       Authentication token
    --relay <url>          Custom relay URL
    --debugPort <port>     Local debugger port (default: 4040)

  \x1b[1mRelay Options:\x1b[0m
    --port <port>          Relay port (default: 6969)
    --max-rps <num>        Max requests per second (default: 150)
    --max-otp <num>        Max OTP attempts (default: 5)
    --brand <name>         Custom brand name
    --theme <dark|light>   Custom brand theme
    --token <secret>       Authentication token
    --key <path>           TLS key file
    --cert <path>          TLS cert file
  `);
  process.exit(0);
}

// Map command to entry points
// For the published package, we'll use the bundled files in dist/
const isDev = import.meta.url.includes("src/cli.ts");
const base = isDev ? join(import.meta.dir, "..") : import.meta.dir;

if (command === "relay") {
  const relayPath = isDev
    ? join(base, "apps/relay/src/index.ts")
    : join(base, "relay.js");
  // Pass args to the imported module by ensuring Bun.argv remains intact or is sliced correctly
  await import(relayPath);
} else {
  const agentPath = isDev
    ? join(base, "apps/agent/src/index.ts")
    : join(base, "agent.js");
  await import(agentPath);
}
