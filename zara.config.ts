export default {
    async onRequest(req: any) {
        // Example: Inject a custom header
        req.headers['x-zara-intercepted'] = 'true';
        return req;
    },
    async onResponse(res: any) {
        // Example: Add a security header to every response
        res.headers['x-content-type-options'] = 'nosniff';
        return res;
    }
};
