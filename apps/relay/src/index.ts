import { parseArgs } from "util";
import { serve, type ServerWebSocket } from "bun";
import { hashOTP, generateOTP, generateTunnelId } from "../../../packages/shared";
import { provisionCerts } from "../../../packages/shared/certs";
import { encodeMessage, decodeMessage } from "../../../packages/protocol/encoding";
import type { TunnelMessage, TunnelRequest, TunnelResponse, AgentHello, TunnelReady } from "../../../packages/protocol";

const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
        port: { type: "string" },
        "max-rps": { type: "string" },
        "max-otp": { type: "string" },
        brand: { type: "string" },
        token: { type: "string" },
        key: { type: "string" },
        cert: { type: "string" },
        theme: { type: "string" },
    },
    strict: false,
});

interface TunnelConnection {
    socket: ServerWebSocket<WebSocketData>;
    localPort: number;
    tcpServer?: any;
    requestCount: number;
    lastRequestAt: number;
}

interface TunnelGroup {
    tunnelId: string;
    type: 'http' | 'tcp';
    otpHash?: string;
    otpAttempts: number;
    otpExpiresAt?: number;
    verifiedSessions: Map<string, number>;
    connections: TunnelConnection[];
    nextIndex: number;
}

interface WebSocketData {
    tunnelId?: string;
    connectionId?: string;
    host?: string;
}

const MAX_RPS = parseInt((values["max-rps"] as string) || process.env.MAX_RPS || "150");
const MAX_OTP_ATTEMPTS = parseInt((values["max-otp"] as string) || process.env.MAX_OTP_ATTEMPTS || "5");
const OTP_TTL_MS = 10 * 60 * 1000;
const BRAND_NAME = (values.brand as string) || process.env.ZARA_BRAND_NAME || "ZARA";
const BRAND_THEME = (values.theme as string) || process.env.ZARA_BRAND_THEME || "dark";
const AUTH_TOKEN = (values.token as string) || process.env.ZARA_AUTH_TOKEN;

const tunnels = new Map<string, TunnelGroup>();
const pendingRequests = new Map<string, (res: TunnelResponse, body?: Uint8Array) => void>();
const tcpSockets = new Map<string, any>();

// Cert Provisioning
const keyFile = (values.key as string) || process.env.KEY_FILE;
const certFile = (values.cert as string) || process.env.CERT_FILE;

const certs = (keyFile && certFile)
    ? { key: keyFile, cert: certFile }
    : provisionCerts(process.cwd());

const server = serve<WebSocketData>({
    port: parseInt((values.port as string) || process.env.PORT || "6969"),
    tls: {
        key: Bun.file(certs.key),
        cert: Bun.file(certs.cert),
    },

    async fetch(req, server) {
        const responseHeaders = new Headers();
        responseHeaders.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

        const url = new URL(req.url);
        const host = req.headers.get("host") || "";
        const tunnelId = host.split(".")[0];

        if (url.pathname === "/_ws") {
            return server.upgrade(req, { data: { tunnelId: undefined, host } }) ? undefined : new Response("Upgrade Failed", { status: 400 });
        }

        if (!tunnelId || tunnelId === "localhost") return new Response(`ZARA Relay: ${BRAND_NAME}`, { status: 200 });

        const group = tunnels.get(tunnelId);
        if (group && group.type === 'http' && group.connections.length > 0) {
            const sessionToken = req.headers.get("cookie")?.split("; ").find(c => c.startsWith("zara_session="))?.split("=")[1];
            const sessionExpiry = sessionToken ? group.verifiedSessions.get(sessionToken) : undefined;

            if (group.otpHash && (!sessionToken || !sessionExpiry || sessionExpiry < Date.now())) {
                if (group.otpAttempts >= MAX_OTP_ATTEMPTS) return new Response("Access Locked", { status: 403 });

                if (req.method === "POST" && url.pathname === "/_otp") {
                    const formData = await req.formData();
                    const otp = formData.get("otp");
                    if (typeof otp !== "string") return new Response("Invalid", { status: 400 });

                    if (await hashOTP(otp, tunnelId) === group.otpHash) {
                        const newToken = crypto.randomUUID();
                        group.verifiedSessions.set(newToken, Date.now() + 86400000);
                        group.otpAttempts = 0;
                        return new Response("OK", { status: 302, headers: { ...Object.fromEntries(responseHeaders.entries()), "Location": "/", "Set-Cookie": `zara_session=${newToken}; Path=/; HttpOnly; SameSite=Lax; Secure` } });
                    } else { group.otpAttempts++; return new Response("Unauthorized", { status: 401 }); }
                }

                return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${BRAND_NAME}</title><style>body{background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{background:#111;padding:40px;border-radius:12px;border:1px solid #222;width:320px;text-align:center}input{width:100%;padding:12px;background:#000;border:1px solid #222;border-radius:6px;color:#fff;margin-bottom:16px;text-align:center}button{width:100%;padding:12px;background:#fff;color:#000;border:none;border-radius:6px;font-weight:600;cursor:pointer}</style></head><body><div class="card"><div style="font-size:24px;font-weight:600;margin-bottom:32px;">${BRAND_NAME}</div><h1>Identity Verification</h1><form action="/_otp" method="POST"><input type="text" name="otp" placeholder="•••••" maxlength="8" required autofocus /><button type="submit">Verify Identity</button></form></div></body></html>`, { headers: { "Content-Type": "text/html", ...Object.fromEntries(responseHeaders.entries()) } });
            }

            // Load Balance: Round Robin
            const connIndex = group.nextIndex % group.connections.length;
            const conn = group.connections[connIndex];
            group.nextIndex++;

            if (!conn) return new Response("ZARA: Internal Load Balancing Error", { status: 500 });

            const now = Date.now();
            if (now - conn.lastRequestAt < 1000) {
                if (++conn.requestCount > MAX_RPS) return new Response("Too Many Requests", { status: 429 });
            } else { conn.requestCount = 1; conn.lastRequestAt = now; }

            const requestId = crypto.randomUUID();
            const body = await req.arrayBuffer();

            return new Promise<Response>((resolve) => {
                const timeout = setTimeout(() => { pendingRequests.delete(requestId); resolve(new Response("Gateway Timeout", { status: 504 })); }, 30000);
                pendingRequests.set(requestId, (res, body) => { clearTimeout(timeout); resolve(new Response(body, { status: res.status, headers: { ...res.headers, ...Object.fromEntries(responseHeaders.entries()) } })); });
                conn.socket.send(encodeMessage({ type: "REQ", requestId, payload: { method: req.method, path: url.pathname + url.search, headers: Object.fromEntries(req.headers.entries()) } as TunnelRequest }, new Uint8Array(body)));
            });
        }

        return new Response("ZARA: Tunnel Not Found or No Agents Online", { status: 404 });
    },
    websocket: {
        async message(ws, data) {
            const { msg, body } = decodeMessage(new Uint8Array(data as any));

            switch (msg.type) {
                case "HELLO": {
                    const hello = msg.payload as AgentHello;
                    if (AUTH_TOKEN && hello.authToken !== AUTH_TOKEN) {
                        ws.send(encodeMessage({ type: "ERROR", payload: "Unauthorized: Invalid token" })); ws.close(); return;
                    }

                    let tunnelId = hello.requestedId || generateTunnelId();

                    let group = tunnels.get(tunnelId);
                    if (!group) {
                        let otp: string | undefined;
                        let otpHash: string | undefined;
                        if (hello.otpRequested) { otp = generateOTP(); otpHash = await hashOTP(otp, tunnelId); }

                        group = {
                            tunnelId, type: hello.type, otpHash, otpAttempts: 0,
                            otpExpiresAt: otpHash ? Date.now() + OTP_TTL_MS : undefined,
                            verifiedSessions: new Map(), connections: [], nextIndex: 0
                        };
                        tunnels.set(tunnelId, group);
                    } else if (group.type !== hello.type) {
                        ws.send(encodeMessage({ type: "ERROR", payload: `Tunnel ${tunnelId} is ${group.type.toUpperCase()}` })); ws.close(); return;
                    }

                    const connectionId = crypto.randomUUID();
                    let tcpServer: any;
                    let tcpPort: number | undefined;

                    if (hello.type === 'tcp') {
                        tcpServer = Bun.listen({
                            hostname: "0.0.0.0", port: 0, socket: {
                                open(socket) {
                                    const connId = crypto.randomUUID();
                                    (socket as any).data = { connId };
                                    tcpSockets.set(connId, socket);
                                    ws.send(encodeMessage({ type: "TCP_OPEN", connectionId: connId }));
                                },
                                data(socket, data) { ws.send(encodeMessage({ type: "TCP_DATA", connectionId: (socket as any).data.connId }, data)); },
                                close(socket) {
                                    ws.send(encodeMessage({ type: "TCP_CLOSE", connectionId: (socket as any).data.connId }));
                                    tcpSockets.delete((socket as any).data.connId);
                                }
                            }
                        });
                        tcpPort = tcpServer.port;
                    }

                    const conn: TunnelConnection = {
                        socket: ws, localPort: hello.port, tcpServer,
                        requestCount: 0, lastRequestAt: Date.now()
                    };
                    group.connections.push(conn);

                    ws.data.tunnelId = tunnelId;
                    ws.data.connectionId = connectionId;

                    ws.send(encodeMessage({ type: "READY", payload: { tunnelId, url: `https://${tunnelId}.${ws.data.host || 'localhost'}`, tcpPort } as TunnelReady }));
                    console.log(`ZARA: Agent joined ${hello.type.toUpperCase()} ${tunnelId} (Total: ${group.connections.length})`);
                    break;
                }
                case "RES": {
                    const handler = pendingRequests.get(msg.requestId!);
                    if (handler) { handler(msg.payload as TunnelResponse, body); pendingRequests.delete(msg.requestId!); }
                    break;
                }
                case "TCP_DATA": {
                    const sock = tcpSockets.get(msg.connectionId!);
                    if (sock) sock.write(body);
                    break;
                }
                case "TCP_CLOSE": {
                    const sock = tcpSockets.get(msg.connectionId!);
                    if (sock) { sock.end(); tcpSockets.delete(msg.connectionId!); }
                    break;
                }
                case "PONG": break;
            }
        },
        close(ws) {
            const tid = ws.data.tunnelId;
            const cid = ws.data.connectionId;
            if (tid) {
                const group = tunnels.get(tid);
                if (group) {
                    group.connections = group.connections.filter(c => {
                        if (c.socket === ws) {
                            if (c.tcpServer) c.tcpServer.stop();
                            return false;
                        }
                        return true;
                    });
                    if (group.connections.length === 0) {
                        tunnels.delete(tid);
                        console.log(`ZARA: Closed tunnel ${tid} (No agents remaining)`);
                    } else {
                        console.log(`ZARA: Agent left ${tid} (Remaining: ${group.connections.length})`);
                    }
                }
            }
        }
    }
});

console.log(`ZARA Relay running at ${server.url}`);
