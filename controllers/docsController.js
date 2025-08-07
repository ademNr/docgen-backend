const {
    generateDocsService,
    getProgressEmitter
} = require('../services/docsService');
const { createJobId } = require('../utils/helpers');

const generateDocs = async (req, res) => {
    try {
        const { owner, repo, includeTests = false } = req.body;
        const user = req.user;
        const token = req.token;

        const result = await generateDocsService({
            user,
            token,
            owner,
            repo,
            includeTests
        });

        res.json(result);

    } catch (error) {
        let status = 500;

        if (error.message === 'Insufficient credits') {
            status = 402;
        } else if (error.status === 404) {
            status = 404;
        } else if (error.status === 401) {
            status = 401;
        }

        res.status(status).json({
            error: error.message,
            lifeTimePlan: req.user?.lifeTimePlan || false
        });
    }
};

const getGenerateProgress = (req, res) => {
    const { owner, repo, token } = req.query;

    console.log('📡 EventSource connection request:', { owner, repo, tokenPrefix: token?.substring(0, 10) });

    if (!owner || !repo || !token) {
        console.log('❌ Missing parameters for EventSource');
        return res.status(400).json({ error: 'Missing parameters' });
    }

    const jobId = createJobId(owner, repo, token);
    console.log('🔑 Generated jobId:', jobId);

    const progressEmitter = getProgressEmitter(jobId);
    console.log('📻 Got progress emitter:', progressEmitter);

    // Set up Server-Sent Events headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': req.headers.origin || '*',
        'Access-Control-Allow-Credentials': 'true',
        'X-Accel-Buffering': 'no' // Disable nginx buffering
    });

    console.log('✅ EventSource headers sent');

    const sendProgress = (data) => {
        const message = `data: ${JSON.stringify(data)}\n\n`;
        console.log('📤 Sending progress data:', message.trim());
        res.write(message);
    };

    // Send initial connection message
    sendProgress({
        progress: 0,
        message: 'Connected to progress stream',
        timestamp: new Date().toISOString()
    });

    // Listen for progress events
    const progressHandler = (data) => {
        console.log('📨 Progress event received:', data);
        sendProgress({
            progress: data.progress,
            message: data.message,
            currentFile: data.currentFile,
            timestamp: new Date().toISOString()
        });
    };

    progressEmitter.on('progress', progressHandler);
    console.log('👂 Listening for progress events on jobId:', jobId);

    // Handle client disconnect
    req.on('close', () => {
        console.log('🔌 Client disconnected from EventSource');
        progressEmitter.off('progress', progressHandler);
    });

    req.on('error', (err) => {
        console.log('❌ EventSource request error:', err);
        progressEmitter.off('progress', progressHandler);
    });

    // Keep connection alive with heartbeat
    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 30000);

    req.on('close', () => {
        clearInterval(heartbeat);
    });
};

module.exports = {
    generateDocs,
    getGenerateProgress
};
