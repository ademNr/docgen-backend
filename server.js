require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const mongoose = require('mongoose');
const User = require('./models/User');

const EventEmitter = require('events');
const crypto = require('crypto');
const app = express();


app.use(cors({ origin: "*" }));

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,

})
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err));

// Body parser middleware
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

async function getOctokit() {
    const { Octokit } = await import('@octokit/rest');
    return Octokit;
}

const rateLimit = require('express-rate-limit');

// Rate limiting for API protection
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: 'Too many requests from this IP, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', apiLimiter);



const progressChannels = {};

function createJobId(owner, repo, token) {
    return crypto.createHash('sha256').update(`${owner}${repo}${token}`).digest('hex');
}

function getProgressEmitter(jobId) {
    if (!progressChannels[jobId]) {
        progressChannels[jobId] = new EventEmitter();
    }
    return progressChannels[jobId];
}

function emitProgress(jobId, progress, message, currentFile = null) {
    const emitter = getProgressEmitter(jobId);
    emitter.emit('progress', {
        progress,
        message,
        currentFile
    });
}

function removeProgressEmitter(jobId) {
    delete progressChannels[jobId];
}

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Progress tracking endpoint
app.get('/api/generate-progress', (req, res) => {
    const { owner, repo, token } = req.query;

    if (!owner || !repo || !token) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    const jobId = createJobId(owner, repo, token);
    const progressEmitter = getProgressEmitter(jobId);

    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': req.headers.origin || '*',
        'Access-Control-Allow-Credentials': 'true'
    });

    const sendProgress = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    progressEmitter.on('progress', sendProgress);

    req.on('close', () => {
        progressEmitter.off('progress', sendProgress);
        if (progressEmitter.listenerCount('progress') === 0) {
            removeProgressEmitter(jobId);
        }
    });
});

// GitHub OAuth endpoint - FIXED
app.post('/api/auth/github', async (req, res) => {
    try {
        console.log('GitHub auth request received:', req.body);

        const { code } = req.body;

        if (!code) {
            return res.status(400).json({ error: 'Authorization code is required' });
        }

        const response = await axios.post(
            'https://github.com/login/oauth/access_token',
            {
                client_id: process.env.GITHUB_CLIENT_ID,
                client_secret: process.env.GITHUB_CLIENT_SECRET,
                code,
            },
            {
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                timeout: 10000 // 10s timeout
            }
        );

        if (!response.data.access_token) {
            console.error('No access token in response:', response.data);
            return res.status(401).json({ error: 'GitHub authentication failed' });
        }


        // Get GitHub user info
        const userResponse = await axios.get('https://api.github.com/user', {
            headers: { Authorization: `token ${response.data.access_token}` }
        });





        const githubUser = userResponse.data;


        console.log(githubUser);

        // Find or create user using githubId (which is the numeric ID from GitHub)
        let user = await User.findOne({ githubId: githubUser.id });

        if (!user) {
            user = new User({
                githubId: githubUser.id,
                login: githubUser.login, // store the username as well

                accessToken: response.data.access_token,
                credits: 1
            });
        } else {
            user.accessToken = response.data.access_token;
            user.lastLogin = new Date();
        }

        await user.save().catch(err => {
            console.error('Error saving user:', err);
            throw new Error('Failed to save user');
        });

        res.json({
            token: response.data.access_token,
            credits: user.credits,
            userId: githubUser.id,
            isSubscribed: user.lifeTimePlan
        });
    } catch (error) {
        console.error('GitHub auth error:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Authentication service unavailable',
            details: error.message
        });
    }
});
// Generate docs endpoint
// Generate docs endpoint with lifetime plan support
app.post('/api/generate-docs', async (req, res) => {
    const { userId, owner, repo, includeTests = false } = req.body;
    const authHeader = req.headers.authorization;
    const defaultCost = 1;

    // Verify authorization header
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized - Bearer token required' });
    }

    const token = authHeader.split(' ')[1];
    const jobId = createJobId(owner, repo, token);

    try {
        // First find the user by ID and verify the token matches
        const user = await User.findOne({
            githubId: userId,
        });

        if (!user) {
            emitProgress(jobId, -1, 'User not found or token mismatch');
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check if user has lifetime plan
        const hasLifetimePlan = user.lifeTimePlan;
        const cost = hasLifetimePlan ? 0 : defaultCost;

        // Skip credit check for lifetime users
        if (!hasLifetimePlan && user.credits < cost) {
            emitProgress(jobId, -1, `Insufficient credits. Need ${cost}, have ${user.credits}`);
            return res.status(402).json({
                error: 'Insufficient credits',
                required: cost,
                available: user.credits,
                lifeTimePlan: user.lifeTimePlan
            });
        }

        emitProgress(jobId, 5, 'Initializing documentation generation...');

        const Octokit = await getOctokit();
        const octokit = new Octokit({
            auth: token,
            request: { timeout: 30000 }
        });

        // 1. Get repository metadata
        emitProgress(jobId, 10, 'Fetching repository metadata...');
        const repoData = await octokit.repos.get({ owner, repo });
        const defaultBranch = repoData.data.default_branch;

        // 2. Get repository contents
        emitProgress(jobId, 20, 'Discovering repository structure...');
        const { data: contents } = await octokit.repos.getContent({
            owner,
            repo,
            ref: defaultBranch,
            path: ''
        });

        // 3. Process files
        emitProgress(jobId, 30, 'Starting file analysis...');
        const codeFiles = await processRepositoryContents(
            octokit,
            owner,
            repo,
            contents,
            includeTests,
            '',
            jobId
        );

        emitProgress(jobId, 50, `Processed ${codeFiles.length} files`);
        emitProgress(jobId, 60, 'Generating documentation with AI...');

        // 4. Generate documentation
        const documentation = await generateAIDocumentation(
            codeFiles,
            repoData.data
        );

        emitProgress(jobId, 90, 'Documentation generated successfully!');

        // Only deduct credits for non-lifetime users
        if (!hasLifetimePlan) {
            user.credits -= cost;
            await user.save();
        }

        // Return documentation with updated user info
        res.json({
            documentation,
            credits: user.credits,
            lifeTimePlan: user.lifeTimePlan
        });

        emitProgress(jobId, 100, 'Documentation ready');
    } catch (error) {
        console.error('Documentation generation error:', error);
        emitProgress(jobId, -1, `Error: ${error.message}`);

        // If we failed after deducting credits, refund them
        if (error.isCreditDeductionError && !user.lifeTimePlan) {
            try {
                const user = await User.findOne({ githubId: userId });
                if (user) {
                    user.credits += defaultCost;
                    await user.save();
                }
            } catch (refundError) {
                console.error('Failed to refund credits:', refundError);
            }
        }

        let status = 500;
        let message = 'Documentation generation failed';

        if (error.status === 404) {
            status = 404;
            message = 'Repository not found';
        } else if (error.status === 403) {
            status = 403;
            message = 'API rate limit exceeded';
        } else if (error.status === 401) {
            status = 401;
            message = 'Invalid access token';
        }

        res.status(status).json({
            error: message,
            details: error.message,
            lifeTimePlan: user?.lifeTimePlan || false
        });
    }
});
app.post('/api/admin/add-credits', async (req, res) => {
    const { adminKey, githubId, amount } = req.body;

    if (adminKey !== process.env.ADMIN_KEY) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    try {
        const user = await User.findOne({ githubId });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.credits += parseInt(amount);
        await user.save();

        res.json({
            githubId,
            newCredits: user.credits
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});
// get user credits
app.post('/api/user/credits', async (req, res) => {
    const { userId } = req.body;
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];

    try {
        // First verify the token matches the user
        const user = await User.findOne({
            githubId: userId,

        });

        if (!user) {
            return res.status(404).json({ error: 'User not found or token mismatch' });
        }

        res.json({
            credits: user.credits,
            lastLogin: user.lastLogin,
            isSubscribed: user.lifeTimePlan
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});
// User repositories endpoint
app.get('/api/user/repos', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized - Bearer token required' });
        }

        const token = authHeader.split(' ')[1];

        const response = await axios.get('https://api.github.com/user/repos', {
            headers: {
                Authorization: `token ${token}`,
                Accept: 'application/vnd.github.v3+json'
            },
            params: {
                sort: 'updated',
                direction: 'desc',
                per_page: 100
            }
        });

        const repos = response.data.map(repo => ({
            id: repo.id,
            name: repo.name,
            owner: repo.owner.login,
            full_name: repo.full_name,
            description: repo.description,
            language: repo.language,
            stars: repo.stargazers_count,
            forks: repo.forks_count,
            updated_at: repo.updated_at,
            html_url: repo.html_url,
            default_branch: repo.default_branch
        }));

        res.json(repos);
    } catch (error) {
        console.error('Error fetching repositories:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch repositories' });
    }
});

// Helper functions (keeping the rest of your code)
function getRelativePath(fullPath, basePath) {
    return basePath ? fullPath.replace(basePath + '/', '') : fullPath;
}

async function processRepositoryContents(octokit, owner, repo, contents, includeTests, path = '', jobId = null) {
    const results = [];
    let processedCount = 0;

    // Define patterns for skipping directories and files
    const SKIP_DIRS = new Set([
        '.git', '.github', '.vscode', '.idea',
        'node_modules', 'vendor', 'dist', 'build',
        'out', 'bin', 'obj', '__pycache__', 'coverage'
    ]);

    const SKIP_FILE_PATTERNS = [
        /\.min\.js$/, /\.min\.css$/,   // Minified files
        /\.(png|jpg|jpeg|gif|bmp|ico|svg|mp4|mov|avi|wav|mp3|ogg)$/i,  // Media files
        /\.(pdf|docx?|xlsx?|pptx?|zip|tar|gz|rar)$/i,  // Documents/archives
        /package-lock\.json$/, /yarn\.lock$/,  // Lock files
        /\.log$/, /\.cache$/, /\.map$/  // Logs and generated files
    ];

    for (const item of contents) {
        try {
            const relativePath = getRelativePath(item.path, path);
            const itemName = item.name.toLowerCase();

            // Skip excluded directories
            if (item.type === 'dir') {
                if (SKIP_DIRS.has(itemName)) {
                    if (jobId) {
                        emitProgress(jobId, null, `Skipped directory: ${relativePath}`);
                    }
                    continue;
                }

                if (jobId) {
                    emitProgress(jobId, null, `Scanning directory: ${relativePath}`);
                }

                const { data: dirContents } = await octokit.repos.getContent({
                    owner,
                    repo,
                    path: item.path
                });
                const nestedFiles = await processRepositoryContents(
                    octokit,
                    owner,
                    repo,
                    dirContents,
                    includeTests,
                    item.path,
                    jobId
                );
                results.push(...nestedFiles);
            }
            // Process valid code files
            else if (item.type === 'file' && isCodeFile(item.name, includeTests)) {
                // Skip files matching exclusion patterns
                if (SKIP_FILE_PATTERNS.some(pattern => pattern.test(item.path))) {
                    if (jobId) {
                        emitProgress(jobId, null, `Skipped file: ${relativePath}`);
                    }
                    continue;
                }

                if (jobId) {
                    emitProgress(jobId, null, `Analyzing file: ${relativePath}`);
                }

                const { data: fileData } = await octokit.repos.getContent({
                    owner,
                    repo,
                    path: item.path
                });

                // Skip large files (over 1MB)
                if (fileData.size > 1000000) {
                    if (jobId) {
                        emitProgress(jobId, null, `Skipped large file: ${relativePath}`);
                    }
                    continue;
                }

                results.push({
                    path: item.path,
                    relativePath: relativePath,  // Added for easier reference
                    content: Buffer.from(fileData.content, 'base64').toString('utf-8'),
                    size: fileData.size,
                    sha: fileData.sha  // Added for version tracking
                });

                processedCount++;

                // Batch progress updates
                if (jobId && processedCount % 5 === 0) {
                    emitProgress(jobId, null, `Processed ${processedCount} files...`);
                }
            }
        } catch (error) {
            console.warn(`Error processing ${item.path}:`, error.message);
            if (jobId) {
                emitProgress(jobId, null, `Error processing: ${getRelativePath(item.path, path)}`);
            }
        }
    }

    return results;
}

function isCodeFile(filename, includeTests) {
    const validExtensions = [
        '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.kt', '.go',
        '.rb', '.php', '.cs', '.swift', '.m', '.h', '.c', '.cpp', '.hpp', '.dart'
    ];

    const testPatterns = [
        '/test/', '/tests/', '/__tests__/', '/spec/',
        'test_', '_test.', '.test.', '.spec.'
    ];

    const extension = filename.substring(filename.lastIndexOf('.'));

    if (!validExtensions.includes(extension.toLowerCase())) {
        return false;
    }

    if (!includeTests) {
        for (const pattern of testPatterns) {
            if (filename.includes(pattern)) {
                return false;
            }
        }
    }

    return true;
}

async function generateAIDocumentation(files, repoMetadata) {
    try {
        const prompt = `
You are an expert technical documentation analyzer. Analyze the repository: ${repoMetadata.full_name}

REPOSITORY METADATA:
- Description: ${repoMetadata.description || 'N/A'}
- Primary language: ${repoMetadata.language || 'Multiple'}
- Created: ${new Date(repoMetadata.created_at).toLocaleDateString()}
- Last updated: ${new Date(repoMetadata.updated_at).toLocaleDateString()}

ANALYZE THE CODE AND RETURN A JSON OBJECT WITH THIS EXACT STRUCTURE:

{
  "title": "Project Name",
  "description": "One-line description",
  "tagline": "Catchy tagline",
  "badges": [
    { "label": "Build", "status": "passing", "color": "brightgreen" },
    { "label": "Version", "status": "1.0.0", "color": "blue" }
  ],
  "features": [
    "Feature 1 description",
    "Feature 2 description"
  ],
  "techStack": [
    { "name": "Node.js", "icon": "nodejs" },
    { "name": "Express", "icon": "express" }
  ],
  "installation": {
    "requirements": ["Node.js 14+", "npm or yarn"],
    "steps": [
      "Clone the repository",
      "Install dependencies: npm install",
      "Configure environment variables",
      "Start the server: npm start"
    ]
  },
  "usage": {
    "basic": "Basic usage example code",
    "advanced": "Advanced usage example code"
  },
  "api": [
    {
      "endpoint": "/api/endpoint",
      "method": "POST",
      "description": "Description",
      "parameters": [
        { "name": "param1", "type": "string", "required": true }
      ],
      "example": "curl example"
    }
  ],
  "fileStructure": [
    { "path": "src/", "description": "Source code directory" },
    { "path": "config/", "description": "Configuration files" }
  ],
  "contributing": {
    "setup": "Development setup instructions",
    "guidelines": "Code style guidelines",
    "process": "Pull request process"
  },
  
  "license": "MIT",
  "author": "Author name",
   "bestPractices": {
      "score": 85, // Overall score (0-100)
      "summary": "Brief summary of adherence to best practices",
      "strengths": [
        "List of strengths in following best practices"
      ],
      "improvements": [
        {
          "category": "Testing",
          "suggestions": [
            "Add unit tests for core modules",
            "Implement integration testing"
          ]
        },
        {
          "category": "Security",
          "suggestions": [
            "Sanitize user inputs in API endpoints",
            "Implement rate limiting"
          ]
        }
      ]
    }

}

CODE CONTEXT:
${files.slice(0, 20).map(file => {
            const truncatedContent = file.content.length > 3000
                ? file.content.substring(0, 3000) + '\n... [TRUNCATED]'
                : file.content;
            return `\n\n### FILE: ${file.path}\n\`\`\`\n${truncatedContent}\n\`\`\``;
        }).join('\n')}

IMPORTANT: Return ONLY a complete, valid JSON object. No markdown, no explanations.
IMPORTANT: For best practices Keep the response phrases as short as possible.
        `;

        const response = await callGemini({
            prompt: prompt,
            model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
            maxTokens: 4096
        });

        if (!response) {
            throw new Error('Gemini API returned empty response');
        }

        let jsonString = repairIncompleteJson(response);

        try {
            return JSON.parse(jsonString);
        } catch (parseError) {
            console.error('Final JSON parse error:', parseError);
            console.error('Repaired JSON content:', jsonString);
            throw new Error('Failed to parse even after repair: ' + parseError.message);
        }
    } catch (error) {
        console.error('Documentation generation failed:', error);
        throw new Error('Failed to generate documentation: ' + error.message);
    }
}

function repairIncompleteJson(rawResponse) {
    let jsonStr = rawResponse.trim()
        .replace(/^```(json)?/g, '')
        .replace(/```$/g, '')
        .trim();

    if (!jsonStr.endsWith('}')) {
        if (jsonStr.endsWith('"')) {
            jsonStr += '}';
        }
        else if (jsonStr.match(/\[\s*[^\]]*$/)) {
            jsonStr = jsonStr.replace(/(\s*)$/, ']}$1');
        }
        else if (jsonStr.match(/\{\s*[^}]*$/)) {
            jsonStr = jsonStr.replace(/(\s*)$/, '}$1');
        }
        else if ((jsonStr.match(/"/g) || []).length % 2 !== 0) {
            jsonStr += '"';
        }

        const openBraces = (jsonStr.match(/{/g) || []).length;
        const closeBraces = (jsonStr.match(/}/g) || []).length;
        if (openBraces > closeBraces) {
            jsonStr += '}'.repeat(openBraces - closeBraces);
        }
    }

    jsonStr = jsonStr.replace(/"example":\s*"([^"]*)$/, (match, p1) => {
        return `"example": "${p1.replace(/[^\\]"/g, '')}"`;
    });

    if (!jsonStr.endsWith('}') && jsonStr.startsWith('{')) {
        jsonStr += '}';
    }

    return jsonStr;
}

async function callGemini({ prompt, model }) {
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

        const contents = [
            {
                role: "user",
                parts: [{ text: prompt }]
            }
        ];

        const response = await axios.post(
            url,
            {
                contents,
                generationConfig: {
                    temperature: 0.3,
                    topK: 32,
                    topP: 0.9,
                    maxOutputTokens: 8192
                }
            },
            {
                timeout: 120000,
                headers: { 'Content-Type': 'application/json' }
            }
        );

        return response.data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch (err) {
        console.error('Gemini API error:', err.response?.data?.error || err.message);
        throw err;
    }
}

// Add this endpoint after your existing endpoints
app.post('/api/user/update-email', async (req, res) => {
    const { userId, email } = req.body;

    // Validate inputs
    if (!userId || !email) {
        return res.status(400).json({ error: 'Missing userId or email' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }

    try {
        // Find and update user by GitHub ID only
        const user = await User.findOneAndUpdate(
            { githubId: userId },
            { email: email },
            { new: true } // Return updated document
        );

        if (!user) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        res.json({
            message: 'Email updated successfully',
            email: user.email
        });
    } catch (error) {
        console.error('Email update error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});
// Add this endpoint after your existing routes
app.post('/api/webhook/gumroad', express.urlencoded({ extended: true }), async (req, res) => {


    try {
        const event = req.body;

        // Validate required fields
        if (!event.product_name || !event.email || !event.sale_id) {
            console.warn('Invalid payload', event);
            return res.status(400).json({ error: 'Invalid payload' });
        }

        // Check for lifetime subscription product
        if (event.product_name === "🚀 Lifetime Gitforje Subscription") {
            console.log(`Processing lifetime subscription for: ${event.email}`);

            // Find user by email and update
            const user = await User.findOneAndUpdate(
                { email: event.email },
                {
                    $set: {
                        lifeTimePlan: true,

                    }
                },
                { new: true }
            );



            console.log(`Updated user ${user.githubId} with lifetime access`);
            return res.json({ success: true, message: 'Lifetime access granted' });
        }

        // Not a lifetime subscription - ignore
        res.status(200).json({ success: true, message: 'Event received but not processed' });
    } catch (error) {
        console.error('Gumroad webhook error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get('/api/test', (req, res) => {
    res.json({ message: 'CORS test successful!' });
});
// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`DocsGen backend running on port ${PORT}`);

});