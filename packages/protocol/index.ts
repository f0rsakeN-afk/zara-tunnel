export type MessageType = 'REQ' | 'RES' | 'HELLO' | 'READY' | 'ERROR' | 'TCP_OPEN' | 'TCP_DATA' | 'TCP_CLOSE' | 'PONG';

export interface TunnelMessage {
    type: MessageType;
    requestId?: string;
    connectionId?: string;
    payload?: any;
}

export interface TunnelRequest {
    method: string;
    path: string;
    headers: Record<string, string>;
}

export interface TunnelResponse {
    status: number;
    headers: Record<string, string>;
}

export interface AgentHello {
    type: 'http' | 'tcp';
    port: number;
    otpRequested: boolean;
    requestedId?: string;
    authToken?: string;
}

export interface TunnelReady {
    tunnelId: string;
    url: string;
    otp?: string;
    tcpPort?: number;
}
