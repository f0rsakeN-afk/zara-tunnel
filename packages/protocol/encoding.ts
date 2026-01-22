import type { TunnelMessage } from "./index";

const COMPRESSION_THRESHOLD = 1024; // 1KB

export function encodeMessage(msg: TunnelMessage, body?: Uint8Array): Uint8Array {
    let finalBody = body;
    let compressionFlag = 0; // 0: None, 1: Gzip

    if (body && body.length > COMPRESSION_THRESHOLD) {
        finalBody = Bun.gzipSync(body as any) as any;
        compressionFlag = 1;
    }

    const header = Buffer.from(JSON.stringify(msg));
    const packet = new Uint8Array(4 + 1 + header.length + (finalBody?.length || 0));

    const view = new DataView(packet.buffer);
    view.setUint32(0, header.length, false); // Big-endian
    packet[4] = compressionFlag;

    packet.set(header, 5);

    if (finalBody) {
        packet.set(finalBody as Uint8Array, 5 + header.length);
    }

    return packet;
}

export function decodeMessage(data: Uint8Array): { msg: TunnelMessage; body?: Uint8Array } {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const headerLen = view.getUint32(0, false);
    const compressionFlag = data[4];

    const headerData = data.slice(5, 5 + headerLen);
    const msg = JSON.parse(new TextDecoder().decode(headerData)) as TunnelMessage;

    let body: Uint8Array | undefined;
    if (data.length > 5 + headerLen) {
        body = data.slice(5 + headerLen);
        if (compressionFlag === 1) {
            body = Bun.gunzipSync(body as any) as any as Uint8Array;
        }
    }

    return { msg, body };
}
