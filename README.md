# ZARA: Multi-Protocol Tunneling

ZARA is a state-of-the-art, high-performance, and secure multiprotocol tunneling system built for the **Bun** era. It allows you to instantly expose local HTTP and TCP services to the internet through a hardened binary relay.

---

## � Features

- **Interactive TUI**: Terminal dashboard with keyboard navigation (Up/Down) and instant replay (`R`).
- **CORS Support**: Simple CORS bypass (`--cors`) for local frontend development.
- **Multiprotocol Support**: Seamlessly tunnel **HTTP (Web)**, **Static Folders**, and **Generic TCP** (SSH, Postgres, Redis).
- **Security First**: 
  - **Auto-TLS**: Automatic 4096-bit SSL certificate provisioning with HSTS.
  - **Identity Verification (OTP)**: Protect public web links with a professional OTP portal.
  - **Relay Authentication**: Secure your infrastructure with master auth tokens.
- **Agent Clusters**: Connect multiple agents to the same tunnel ID for automatic Round-Robin load balancing.
- **Protocol Compression**: Automatic Gzip compression for payloads > 1KB.

---

## ⚡ Quick Install

ZARA is optimized for [Bun](https://bun.sh). Install it globally:

```bash
bun install -g zara-tunnel
```

---

## 🚀 Usage

### 1. Expose a Local Web Service
```bash
# Expose port 3000 with a custom name and OTP protection
zara expose 3000 --name my-app --otp
```

### 2. Expose a TCP Service (DB, SSH, etc.)
```bash
zara tcp 5432 --name local-db
```

### 3. Share a Static Directory
```bash
zara share ./dist --name my-site
```

### 4. Start your own Relay (Self-Hosted)
```bash
# Start a relay with a secret token and custom RPS limit
zara relay --token my-secret-token --max-rps 300
```

---

## 🛠️ Advanced Options

- `--name <subdomain>`: Request a specific subdomain (e.g., `my-sub.zara.dev`).
- `--token <secret>`: Authenticate with a secured relay server.
- `--otp`: Enable one-time password protection for web tunnels.
- `--cors`: Enable automatic CORS bypass headers.
- `--relay <url>`: Connect to a custom ZARA relay (default: `wss://localhost:6969/_ws`).
- `--debugPort <number>`: Custom port for the debugger UI (default: 4040).

### Relay Server Options
- `--port <number>`: Port to listen on (default: 6969).
- `--token <secret>`: Shared secret for agent authentication.
- `--max-rps <number>`: Rate limit per agent connection (default: 150).
- `--max-otp <number>`: Max failed OTP attempts before lockout (default: 5).
- `--brand <name>`: Custom brand name for the UI.
- `--theme <dark|light>`: UI theme color scheme.
- `--key <path>`, `--cert <path>`: Custom SSL certificate files.

---

## 🧩 Edge Middleware (`zara.config.ts`)

Create a `zara.config.ts` in your project root to intercept and modify traffic:

```typescript
export default {
  async onRequest(req) {
    req.headers['x-zara-intercepted'] = 'true';
    return req;
  },
  async onResponse({ status, headers, body }) {
    headers['x-powered-by'] = 'ZARA';
    return { status, headers, body };
  }
};
```

---

## 🐳 Docker

ZARA is container-ready. Use our high-performance images:

```bash
# Run the entire stack via Docker Compose
docker-compose up --build
```

---

## 🧱 Technical Architecture

ZARA uses a high-concurrency binary multiplexing protocol built on WebSockets.

```mermaid
graph TD
    V[Visitor Client] -->|HTTPS| R[Relay Server]
    R <-->|Binary WS Multiplex| A[Local Agent]
    A <-->|HTTP/TCP| LS[Local Service]
```

### Tech Stack
- **Runtime**: [Bun](https://bun.sh)
- **Encryption**: Automatic 4096-bit Certs
- **Compression**: Native Gzip
- **Protocol**: Custom Binary Framing

---

## 💻 Development & Open Source

Contributions are welcome!

```bash
git clone https://github.com/f0rsakeN-afk/zara-tunnel.git
cd zara-tunnel
bun install
bun run build
```

**License**: MIT
