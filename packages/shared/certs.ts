import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

export function provisionCerts(dir: string): { key: string; cert: string } {
    const keyPath = join(dir, "zara-key.pem");
    const certPath = join(dir, "zara-cert.pem");

    if (!existsSync(keyPath) || !existsSync(certPath)) {
        console.log("Generating auto-provisioned self-signed certificate...");

        const result = spawnSync("openssl", [
            "req", "-x509", "-newkey", "rsa:4096",
            "-keyout", keyPath,
            "-out", certPath,
            "-days", "365",
            "-nodes",
            "-subj", "/CN=zara.local/O=Zara/C=US"
        ]);

        if (result.status !== 0) {
            console.error("Failed to generate self-signed certificate:", result.stderr.toString());
            throw new Error("Certificate provisioning failed");
        }

        console.log("Certificate provisioned successfully.");
    }

    return { key: keyPath, cert: certPath };
}
