const { checkConnection } = require('../config/database');

const healthCheck = (req, res) => {
    const dbStatus = checkConnection();

    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        database: dbStatus,
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
};

module.exports = {
    healthCheck
};
