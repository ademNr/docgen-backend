module.exports = {
    port: process.env.PORT || 5000,
    mongoUri: process.env.MONGODB_URI,
    github: {
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET
    },
    gemini: {
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || "gemini-1.5-flash"
    },
    adminKey: process.env.ADMIN_KEY,
    rateLimit: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100
    }
};
