import { parseArgs } from "util";
import { serve, file } from "bun";
import { existsSync, statSync } from "fs";
import type { TunnelMessage, TunnelRequest, TunnelResponse, AgentHello, TunnelReady } from "../../../packages/protocol";
import { encodeMessage, decodeMessage } from "../../../packages/protocol/encoding";

interface HistoryItem {
    id: string;
    method: string;
    path: string;
    status: number;
    duration: number;
    headers: Record<string, string>;
    rawBody?: Uint8Array;
    reqSize: number;
    resSize: number;
    isReplay?: boolean;
    isWebhook?: boolean;
    resBody?: Uint8Array;
}

const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
        otp: { type: "boolean", default: false },
        cors: { type: "boolean", default: false },
        port: { type: "string" },
        name: { type: "string" },
        token: { type: "string" },
        relay: { type: "string", default: "wss://localhost:6969/_ws" },
        debugPort: { type: "string", default: "4040" }
    },
    strict: false,
});

const command = positionals[0] || "expose";
const mode = command === "tcp" ? "tcp" : "http";
let target = positionals[1] || values.port || "3000";

const port = parseInt(target as string);
const isStatic = command === "share";
const authToken = values.token || process.env.ZARA_AUTH_TOKEN;

if (isStatic && existsSync(target as string)) {
    serve({
        port: 4999,
        fetch(req) {
            const url = new URL(req.url);
            let p = target + url.pathname;
            if (p.endsWith("/")) p += "index.html";
            return existsSync(p) && statSync(p).isFile() ? new Response(file(p)) : new Response("Not Found", { status: 404 });
        }
    });
}

const debugPort = parseInt(values.debugPort as string);
const relayUrl = (values.relay as string);
const requestHistory: HistoryItem[] = [];
let tunnelUrl = "Connecting...";
let tcpPort: number | undefined;
let selectedIndex = 0;

// Interactive TUI
if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (data) => {
        const key = data.toString();
        if (key === "\u0003") process.exit(0); // Ctrl+C
        if (key === "\u001b[A") { // Up
            selectedIndex = Math.min(selectedIndex + 1, requestHistory.length - 1);
            draw();
        }
        if (key === "\u001b[B") { // Down
            selectedIndex = Math.max(0, selectedIndex - 1);
            draw();
        }
        if (key.toLowerCase() === "r") { // Replay
            const item = requestHistory.slice().reverse()[selectedIndex];
            if (item && item.id !== "system") {
                fetch(`http://localhost:${isStatic ? 4999 : port}${item.path}`, { method: item.method, headers: { ...item.headers, "x-zara-replay": "true" }, body: item.rawBody }).catch(() => { });
            }
        }
    });
}

function draw() {
    const termWidth = process.stdout.columns || 80;
    const termHeight = process.stdout.rows || 24;

    process.stdout.write("\x1b[H\x1b[J"); // Clear and home

    // Header
    const brand = " ZARA TUNNEL ";
    const padding = "=".repeat(Math.max(0, (termWidth - brand.length) / 2));
    console.log(`\x1b[1m\x1b[35m${padding}${brand}${padding}\x1b[0m`);

    console.log(`  \x1b[1mStatus:\x1b[0m \x1b[32mACTIVE\x1b[0m | \x1b[1mMode:\x1b[0m ${mode.toUpperCase()}${values.cors ? " | \x1b[33mCORS: ON\x1b[0m" : ""}`);
    console.log(`  \x1b[1mURL:\x1b[0m    \x1b[4m\x1b[36m${tunnelUrl}\x1b[0m`);
    if (tcpPort) console.log(`  \x1b[1mTCP:\x1b[0m    \x1b[33mlocalhost:${tcpPort} -> localhost:${port}\x1b[0m`);
    console.log(`  \x1b[1mDebug:\x1b[0m  http://localhost:${debugPort}`);
    console.log(`\x1b[2m` + "-".repeat(termWidth) + `\x1b[0m`);

    // History
    console.log(`  \x1b[1mRECENT TRAFFIC\x1b[0m`);
    const historyCount = Math.max(5, termHeight - 12);
    const history = requestHistory.slice(-historyCount).reverse();

    if (history.length === 0) {
        console.log(`\n\x1b[2m  No traffic detected yet...\x1b[0m`);
    } else {
        history.forEach((h, i) => {
            const isSelected = i === selectedIndex;
            const pointer = isSelected ? "\x1b[35m▶\x1b[0m" : " ";
            const bg = isSelected ? "\x1b[48;5;234m" : "";
            const statusCol = h.status >= 500 ? "\x1b[31m" : h.status >= 400 ? "\x1b[33m" : "\x1b[32m";
            const path = h.path.length > termWidth - 40 ? h.path.slice(0, termWidth - 43) + "..." : h.path;
            process.stdout.write(`${pointer}${bg} \x1b[2m${new Date().toLocaleTimeString()}\x1b[0m ${statusCol}${h.status}\x1b[0m \x1b[1m${h.method}\x1b[0m ${path} \x1b[2m${h.duration}ms\x1b[0m\x1b[0m\n`);
        });
    }

    // Footer
    process.stdout.write(`\x1b[${termHeight};1H\x1b[1m\x1b[45m ZARA \x1b[0m \x1b[2m↑/↓: Navigate | R: Replay Selected | Ctrl+C: Exit\x1b[0m`);
}

setInterval(draw, 1000);

// Local Debugger with Body Inspection
serve({
    port: debugPort,
    async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/history") return Response.json(requestHistory.slice(-50).reverse().map(h => ({ ...h, rawBody: h.rawBody ? '...' : null, resBody: h.resBody ? '...' : null })));
        if (url.pathname === "/api/detail") {
            const id = url.searchParams.get("id");
            const item = requestHistory.find(h => h.id === id);
            if (!item) return new Response("Not Found", { status: 404 });
            return Response.json({
                ...item,
                rawBody: item.rawBody ? new TextDecoder().decode(item.rawBody) : null,
                resBody: item.resBody ? new TextDecoder().decode(item.resBody) : null
            });
        }
        if (url.pathname === "/api/replay") {
            const body = await req.json() as { id: string };
            const item = requestHistory.find(h => h.id === body.id);
            if (item) fetch(`http://localhost:${isStatic ? 4999 : port}${item.path}`, { method: item.method, headers: { ...item.headers, "x-zara-replay": "true" }, body: item.rawBody }).catch(() => { });
            return Response.json({ status: "ok" });
        }
        return new Response(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"><title>ZARA | Local Debugger</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono&display=swap" rel="stylesheet">
    <style>
        :root { --bg: #050505; --card: #0f0f0f; --text: #e0e0e0; --accent: #fff; --border: #1a1a1a; }
        body { margin: 0; background: var(--bg); color: var(--text); font-family: 'Inter', sans-serif; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
        nav { padding: 1rem 2rem; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
        .dashboard { display: grid; grid-template-columns: 1fr 450px; flex: 1; overflow: hidden; }
        .req-list { overflow-y: auto; padding: 1rem; border-right: 1px solid var(--border); }
        .inspector { padding: 1.5rem; overflow-y: auto; background: #080808; display: none; }
        .req-item { background: var(--card); border: 1px solid var(--border); padding: 12px; border-radius: 6px; font-family: 'JetBrains Mono'; font-size: 12px; display: grid; grid-template-columns: 60px 60px 1fr 80px 80px; align-items: center; cursor: pointer; margin-bottom: 6px; }
        .req-item:hover { border-color: #333; }
        .req-item.active { border-color: #fff; background: #151515; }
        .tag { font-size: 9px; padding: 2px 4px; border-radius: 3px; font-weight: 700; margin-left: 5px; background: #333; }
        pre { background: #000; padding: 1rem; border-radius: 4px; font-size: 12px; white-space: pre-wrap; word-break: break-all; border: 1px solid #111; }
        .status-200 { color: #4caf50; }
        h3 { font-size: 14px; text-transform: uppercase; color: #555; margin: 1.5rem 0 0.5rem 0; }
    </style>
</head>
<body>
    <nav><div style="font-weight:600; letter-spacing:-0.05em">ZARA DEBUGGER</div><div>${port}</div></nav>
    <div class="dashboard">
        <div class="req-list" id="list"></div>
        <div class="inspector" id="inspector">
            <div style="display: flex; justify-content: space-between; align-items: center">
                <h2 id="ins-title" style="margin:0; font-size: 16px;">Request Details</h2>
                <button onclick="doReplay()" style="background:#fff; color:#000; border:none; padding:5px 10px; border-radius:4px; font-weight:600; font-size:11px; cursor:pointer">REPLAY</button>
            </div>
            <h3>Request Body</h3><pre id="ins-req">None</pre>
            <h3>Response Body</h3><pre id="ins-res">None</pre>
            <h3>Headers</h3><pre id="ins-head">None</pre>
        </div>
    </div>
    <script>
        let selectedId = null;
        async function inspect(id) {
            selectedId = id;
            document.querySelectorAll('.req-item').forEach(el => el.classList.toggle('active', el.dataset.id === id));
            const res = await fetch(\`/api/detail?id=\${id}\`);
            const data = await res.json();
            document.getElementById('inspector').style.display = 'block';
            document.getElementById('ins-req').textContent = data.rawBody || 'No Body';
            document.getElementById('ins-res').textContent = data.resBody || 'No Body';
            document.getElementById('ins-head').textContent = JSON.stringify(data.headers, null, 2);
        }
        async function doReplay() { if(selectedId) await fetch('/api/replay', { method: 'POST', body: JSON.stringify({ id: selectedId }) }); }
        async function update() {
            const res = await fetch('/api/history');
            const data = await res.json();
            document.getElementById('list').innerHTML = data.map(r => \`
                <div class="req-item \${r.id === selectedId ? 'active' : ''}" onclick="inspect('\${r.id}')" data-id="\${r.id}">
                    <span style="color:#888">\${r.method}</span>
                    <span class="status-\${r.status}">\${r.status}</span>
                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">\${r.path}</span>
                    <span style="text-align:right; color:#444">\${r.duration}ms</span>
                    <span style="text-align:right; font-size:10px; color:#666">\${( (r.reqSize+r.resSize)/1024 ).toFixed(1)}KB</span>
                </div>
            \`).join('');
        }
        setInterval(update, 1000); update();
    </script>
</body>
</html>
        `, { headers: { "Content-Type": "text/html" } });
    }
});

// Middleware Support
let middleware: any = null;
if (existsSync("zara.config.ts")) {
    try {
        middleware = (await import(process.cwd() + "/zara.config.ts")).default;
        requestHistory.push({ id: "system", method: "CONFIG", path: "zara.config.ts loaded", status: 200, duration: 0, headers: {}, reqSize: 0, resSize: 0 });
    } catch (e) {
        requestHistory.push({ id: "system", method: "CONFIG", path: "Error loading zara.config.ts", status: 500, duration: 0, headers: {}, reqSize: 0, resSize: 0 });
    }
}

const tcpConnections = new Map<string, any>();

// Proxy Logic
function connect() {
    const ws = new WebSocket(relayUrl);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
        ws.send(encodeMessage({ type: "HELLO", payload: { type: mode, port: isStatic ? 4999 : port, otpRequested: values.otp as boolean, requestedId: values.name as string, authToken } as AgentHello }));
    };
    ws.onmessage = async (event) => {
        const { msg, body: rawBody } = decodeMessage(new Uint8Array(event.data as ArrayBuffer));

        if (msg.type === "READY") {
            const r = msg.payload as TunnelReady;
            tunnelUrl = r.url;
            tcpPort = r.tcpPort;
            if (r.otp) requestHistory.push({ id: "system", method: "OTP", path: r.otp, status: 200, duration: 0, headers: {}, reqSize: 0, resSize: 0 });
            draw();
        } else if (msg.type === "ERROR") {
            tunnelUrl = `Error: ${msg.payload}`;
            draw();
        } else if (msg.type === "REQ") {
            let req = msg.payload as TunnelRequest;
            const start = Date.now();

            // CORS Preflight Handler
            if (values.cors && req.method === "OPTIONS") {
                const corsHeaders = {
                    "access-control-allow-origin": "*",
                    "access-control-allow-methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
                    "access-control-allow-headers": "*",
                    "access-control-max-age": "86400"
                };
                ws.send(encodeMessage({ type: "RES", requestId: msg.requestId, payload: { status: 204, headers: corsHeaders } }, new Uint8Array()));
                requestHistory.push({ id: msg.requestId!, method: "OPTIONS", path: req.path, status: 204, duration: Date.now() - start, headers: req.headers, rawBody, reqSize: 0, resSize: 0 });
                draw();
                return;
            }

            // Apply Middleware
            if (middleware?.onRequest) {
                try { req = await middleware.onRequest(req); } catch (e) { }
            }

            try {
                const res = await fetch(`http://localhost:${isStatic ? 4999 : port}${req.path}`, {
                    method: req.method, headers: { ...req.headers, host: `localhost:${isStatic ? 4999 : port}` }, body: rawBody, redirect: "manual", //@ts-ignore
                    tls: { rejectUnauthorized: false }
                });

                const buf = await res.arrayBuffer();
                let uint8 = new Uint8Array(buf);
                let status = res.status;
                let headers = Object.fromEntries(res.headers.entries());

                // CORS Handler
                if (values.cors) {
                    headers["access-control-allow-origin"] = "*";
                    headers["access-control-allow-methods"] = "*";
                    headers["access-control-allow-headers"] = "*";
                }

                // Apply Post-Middleware
                if (middleware?.onResponse) {
                    try {
                        const modified = await middleware.onResponse({ status, headers, body: uint8 });
                        status = modified.status;
                        headers = modified.headers;
                        uint8 = modified.body || uint8;
                    } catch (e) { }
                }

                ws.send(encodeMessage({ type: "RES", requestId: msg.requestId, payload: { status, headers } }, uint8));
                requestHistory.push({ id: msg.requestId!, method: req.method, path: req.path, status, duration: Date.now() - start, headers: req.headers, rawBody, reqSize: rawBody?.length || 0, resSize: uint8.length, resBody: uint8 });
            } catch (e) { ws.send(encodeMessage({ type: "RES", requestId: msg.requestId, payload: { status: 502, headers: {} } }, new Uint8Array())); }
            draw();
        } else if (msg.type === "TCP_OPEN") {
            const conn = await Bun.connect({
                hostname: "localhost",
                port: port,
                socket: {
                    data(socket, data) { ws.send(encodeMessage({ type: "TCP_DATA", connectionId: msg.connectionId }, data)); },
                    close(socket) {
                        ws.send(encodeMessage({ type: "TCP_CLOSE", connectionId: msg.connectionId }));
                        tcpConnections.delete(msg.connectionId!);
                    },
                    error(socket, error) { ws.send(encodeMessage({ type: "TCP_CLOSE", connectionId: msg.connectionId })); }
                }
            });
            tcpConnections.set(msg.connectionId!, conn);
        } else if (msg.type === "TCP_DATA") {
            const conn = tcpConnections.get(msg.connectionId!);
            if (conn) conn.write(rawBody);
        } else if (msg.type === "TCP_CLOSE") {
            const conn = tcpConnections.get(msg.connectionId!);
            if (conn) { conn.end(); tcpConnections.delete(msg.connectionId!); }
        }
    };
    ws.onclose = () => { setTimeout(connect, 3000); };
}
connect();
process.on("SIGINT", () => process.exit(0));
