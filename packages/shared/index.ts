export async function hashOTP(otp: string, tunnelId: string): Promise<string> {
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(otp + tunnelId);
    return hasher.digest("hex");
}

export function generateOTP(length = 6): string {
    const chars = "0123456789";
    let otp = "";
    for (let i = 0; i < length; i++) {
        otp += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return otp;
}

export function generateTunnelId(): string {
    const adjectives = ["quick", "lazy", "happy", "brave", "silent", "fast", "bright"];
    const nouns = ["fox", "bear", "lion", "wolf", "eagle", "tiger", "hawk"];
    const randomNum = Math.floor(Math.random() * 1000);

    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];

    return `${adj}-${noun}-${randomNum}`;
}
