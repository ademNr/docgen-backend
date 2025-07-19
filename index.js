require('dotenv').config();
const express = require('express');
const axios = require('axios');
async function getOctokit() {
    const { Octokit } = await import('@octokit/rest');
    return Octokit;
}
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const app = express();

// Middleware
// cors : origin: process.env.CLIENT_URL || 'http://localhost:3000'
app.use(cors({ origin: "http://localhost:3000" }));
app.use(express.json());

// Rate limiting for API protection
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: 'Too many requests from this IP, please try again later'
});
app.use('/api/', apiLimiter);

// GitHub OAuth token exchange

const EventEmitter = require('events');
const crypto = require('crypto');

// Add these progress tracking utilities
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

function emitProgress(jobId, progress, message) {
    const emitter = getProgressEmitter(jobId);
    emitter.emit('progress', { progress, message });
}

function removeProgressEmitter(jobId) {
    delete progressChannels[jobId];
}

app.get('/api/generate-progress', (req, res) => {
    const { owner, repo, token } = req.query;

    if (!owner || !repo || !token) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    const jobId = createJobId(owner, repo, token);
    const progressEmitter = getProgressEmitter(jobId);

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
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
// Update generate-docs endpoint with progress tracking
app.post('/api/generate-docs', async (req, res) => {
    const { token, owner, repo, includeTests = false } = req.body;
    const jobId = createJobId(owner, repo, token);

    try {
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

        // 3. Process files - pass jobId for progress tracking
        emitProgress(jobId, 30, 'Starting file analysis...');
        const codeFiles = await processRepositoryContents(
            octokit,
            owner,
            repo,
            contents,
            includeTests,
            '',
            jobId  // Pass jobId to file processor
        );

        emitProgress(jobId, 50, `Processed ${codeFiles.length} files`);
        emitProgress(jobId, 60, 'Generating documentation with AI...');

        // 4. Generate documentation
        const documentation = await generateAIDocumentation(
            codeFiles,
            repoData.data
        );

        emitProgress(jobId, 90, 'Documentation generated successfully!');
        res.json({ documentation });
        emitProgress(jobId, 100, 'Documentation ready');
    } catch (error) {
        console.error('Documentation generation error:', error);
        emitProgress(jobId, -1, `Error: ${error.message}`);


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

        res.status(status).json({ error: message });
    }
});
app.post('/api/auth/github', async (req, res) => {
    try {
        const { code } = req.body;
        const response = await axios.post(
            'https://github.com/login/oauth/access_token',
            {
                client_id: process.env.GITHUB_CLIENT_ID,
                client_secret: process.env.GITHUB_CLIENT_SECRET,
                code,
            },
            {
                headers: { Accept: 'application/json' },
                timeout: 10000 // 10s timeout
            }
        );

        if (!response.data.access_token) {
            return res.status(401).json({ error: 'GitHub authentication failed' });
        }

        res.json({ token: response.data.access_token });
    } catch (error) {
        console.error('GitHub auth error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Authentication service unavailable' });
    }
});

// Process repository and generate documentation
app.post('/api/generate-docs', async (req, res) => {
    console.log('Received generate-docs request');
    const { token, owner, repo, includeTests = false } = req.body;
    console.log(`Request for repo: ${owner}/${repo}`);
    console.log(`Include tests: ${includeTests}`);
    // Validate input
    if (!token || !owner || !repo) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    try {
        const Octokit = await getOctokit();
        const octokit = new Octokit({
            auth: token,
            request: { timeout: 30000 }
        });

        // 1. Get repository metadata
        const repoData = await octokit.repos.get({ owner, repo });
        const defaultBranch = repoData.data.default_branch;

        // 2. Get repository contents
        const { data: contents } = await octokit.repos.getContent({
            owner,
            repo,
            ref: defaultBranch,
            path: ''
        });

        // 3. Filter and process files
        const codeFiles = await processRepositoryContents(
            octokit,
            owner,
            repo,
            contents,
            includeTests
        );

        // 4. Generate documentation via AI
        const documentation = await generateAIDocumentation(
            codeFiles,
            repoData.data
        );
        console.log('Sending documentation response');
        res.json({
            documentation

        });
    } catch (error) {
        console.error('Documentation generation error:', error);

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

        res.status(status).json({ error: message });
    }
});

function getRelativePath(fullPath, basePath) {
    return basePath ? fullPath.replace(basePath + '/', '') : fullPath;
}

// Update the processRepositoryContents function
async function processRepositoryContents(octokit, owner, repo, contents, includeTests, path = '', jobId = null) {
    const results = [];
    let processedCount = 0;

    for (const item of contents) {
        try {
            const relativePath = getRelativePath(item.path, path);

            if (item.type === 'dir') {
                // Emit directory progress
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
            } else if (item.type === 'file' && isCodeFile(item.name, includeTests)) {
                // Emit file processing start
                if (jobId) {
                    emitProgress(jobId, null, `Analyzing file: ${relativePath}`);
                }

                const { data: fileData } = await octokit.repos.getContent({
                    owner,
                    repo,
                    path: item.path
                });

                if (fileData.size > 1000000) {
                    if (jobId) {
                        emitProgress(jobId, null, `Skipped large file: ${relativePath}`);
                    }
                    continue;
                }

                results.push({
                    path: item.path,
                    content: Buffer.from(fileData.content, 'base64').toString('utf-8'),
                    size: fileData.size
                });

                processedCount++;

                // Update progress every 5 files
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

// Update the emitProgress function
function emitProgress(jobId, progress, message, currentFile = null) {
    const emitter = getProgressEmitter(jobId);
    emitter.emit('progress', {
        progress,
        message,
        currentFile
    });
}


// File type filtering
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

    // Skip non-code files
    if (!validExtensions.includes(extension.toLowerCase())) {
        return false;
    }

    // Filter out test files if not included
    if (!includeTests) {
        for (const pattern of testPatterns) {
            if (filename.includes(pattern)) {
                return false;
            }
        }
    }

    return true;
}

// AI Documentation Generation using Google Gemini
// Enhanced backend response
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
  "author": "Author name"
}

CODE CONTEXT:
${files.slice(0, 20).map(file => {
            const truncatedContent = file.content.length > 3000
                ? file.content.substring(0, 3000) + '\n... [TRUNCATED]'
                : file.content;
            return `\n\n### FILE: ${file.path}\n\`\`\`\n${truncatedContent}\n\`\`\``;
        }).join('\n')}

IMPORTANT RULES FOR YOUR RESPONSE:
1. Return ONLY a complete, valid JSON object
2. Do NOT wrap the response in any Markdown code blocks (no \`\`\`json)
3. Ensure the JSON is properly closed with all brackets and quotes
4. If showing examples, make sure they don't get truncated
5. Escape any special characters in strings
6. The response must be parseable by JSON.parse()

The response must:
- Start with {
- End with }
- Be complete (no truncated examples or arrays)
- Have all strings properly quoted

IMPORTANT RULES:
1. Return ONLY a complete, valid JSON object
2. Ensure the JSON is properly closed with all brackets
3. Keep API examples concise to avoid truncation
4. If any array might be long, limit it to 5 items max
5. Escape all special characters in strings
        `;


        const response = await callGemini({
            prompt: prompt,
            model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
            maxTokens: 4096  // Increase token limit if possible
        });

        if (!response) {
            throw new Error('Gemini API returned empty response');
        }

        // Handle incomplete JSON by attempting to close it
        let jsonString = repairIncompleteJson(response);

        // Parse the JSON response
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
    // Remove Markdown code blocks
    let jsonStr = rawResponse.trim()
        .replace(/^```(json)?/g, '')
        .replace(/```$/g, '')
        .trim();

    // Check for truncation and repair
    if (!jsonStr.endsWith('}')) {
        // Attempt to close JSON structure
        if (jsonStr.endsWith('"')) {
            jsonStr += '}';
        }
        // Handle arrays
        else if (jsonStr.match(/\[\s*[^\]]*$/)) {
            jsonStr = jsonStr.replace(/(\s*)$/, ']}$1');
        }
        // Handle objects
        else if (jsonStr.match(/\{\s*[^}]*$/)) {
            jsonStr = jsonStr.replace(/(\s*)$/, '}$1');
        }
        // Handle mid-string
        else if ((jsonStr.match(/"/g) || []).length % 2 !== 0) {
            jsonStr += '"';
        }

        // Add closing braces if needed
        const openBraces = (jsonStr.match(/{/g) || []).length;
        const closeBraces = (jsonStr.match(/}/g) || []).length;
        if (openBraces > closeBraces) {
            jsonStr += '}'.repeat(openBraces - closeBraces);
        }
    }

    // Repair common truncation in API examples
    jsonStr = jsonStr.replace(/"example":\s*"([^"]*)$/, (match, p1) => {
        return `"example": "${p1.replace(/[^\\]"/g, '')}"`;
    });

    // Ensure final character is closing brace
    if (!jsonStr.endsWith('}') && jsonStr.startsWith('{')) {
        jsonStr += '}';
    }

    return jsonStr;
}


// Gemini API Caller
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
                timeout: 120000, // 120s timeout
                headers: { 'Content-Type': 'application/json' }
            }
        );

        return response.data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch (err) {
        console.error('Gemini API error:', err.response?.data?.error || err.message);
        throw err;
    }
}

// GitHub User Repositories API
app.get('/api/user/repos', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

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

        // Process repositories with essential info
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
// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`DocsGen backend running on port ${PORT}`));