const axios = require('axios');
const config = require('../config');
const { getRelativePath } = require('./helpers');

const SKIP_DIRS = new Set([
    '.git', '.github', '.vscode', '.idea',
    'node_modules', 'vendor', 'dist', 'build',
    'out', 'bin', 'obj', '__pycache__', 'coverage'
]);

const SKIP_FILE_PATTERNS = [
    /\.min\.js$/, /\.min\.css$/,
    /\.(png|jpg|jpeg|gif|bmp|ico|svg|mp4|mov|avi|wav|mp3|ogg)$/i,
    /\.(pdf|docx?|xlsx?|pptx?|zip|tar|gz|rar)$/i,
    /package-lock\.json$/, /yarn\.lock$/,
    /\.log$/, /\.cache$/, /\.map$/
];

const processRepositoryContents = async (octokit, owner, repo, contents, includeTests, path = '', jobId = null, emitProgress = null) => {
    const results = [];
    let processedCount = 0;
    let totalFiles = 0;

    // First, count total files for progress calculation
    const countFiles = (items) => {
        let count = 0;
        for (const item of items) {
            if (item.type === 'file' && isCodeFile(item.name, includeTests)) {
                if (!SKIP_FILE_PATTERNS.some(pattern => pattern.test(item.path))) {
                    count++;
                }
            }
        }
        return count;
    };

    // Count files recursively (simplified for now)
    totalFiles = countFiles(contents);
    console.log(`📊 Total files to process: ${totalFiles}`);

    for (const item of contents) {
        try {
            const relativePath = getRelativePath(item.path, path);
            const itemName = item.name.toLowerCase();

            // Skip excluded directories
            if (item.type === 'dir') {
                if (SKIP_DIRS.has(itemName)) {
                    if (jobId && emitProgress) {
                        emitProgress(jobId, null, `Skipped directory: ${relativePath}`);
                    }
                    continue;
                }

                if (jobId && emitProgress) {
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
                    jobId,
                    emitProgress
                );

                results.push(...nestedFiles);
            }
            // Process valid code files
            else if (item.type === 'file' && isCodeFile(item.name, includeTests)) {
                // Skip files matching exclusion patterns
                if (SKIP_FILE_PATTERNS.some(pattern => pattern.test(item.path))) {
                    if (jobId && emitProgress) {
                        emitProgress(jobId, null, `Skipped file: ${relativePath}`);
                    }
                    continue;
                }

                // Calculate progress based on processed files
                const progressPercent = totalFiles > 0 ? Math.min(50, Math.round((processedCount / totalFiles) * 20) + 30) : null;

                if (jobId && emitProgress) {
                    emitProgress(jobId, progressPercent, `Analyzing file: ${relativePath}`, relativePath);
                }

                const { data: fileData } = await octokit.repos.getContent({
                    owner,
                    repo,
                    path: item.path
                });

                // Skip large files (over 1MB)
                if (fileData.size > 1000000) {
                    if (jobId && emitProgress) {
                        emitProgress(jobId, progressPercent, `Skipped large file: ${relativePath}`);
                    }
                    continue;
                }

                results.push({
                    path: item.path,
                    relativePath: relativePath,
                    content: Buffer.from(fileData.content, 'base64').toString('utf-8'),
                    size: fileData.size,
                    sha: fileData.sha
                });

                processedCount++;

                // Batch progress updates every 5 files
                if (jobId && emitProgress && processedCount % 5 === 0) {
                    const batchProgress = totalFiles > 0 ? Math.min(50, Math.round((processedCount / totalFiles) * 20) + 30) : null;
                    emitProgress(jobId, batchProgress, `Processed ${processedCount} files...`);
                }
            }
        } catch (error) {
            console.warn(`Error processing ${item.path}:`, error.message);
            if (jobId && emitProgress) {
                emitProgress(jobId, null, `Error processing: ${getRelativePath(item.path, path)}`);
            }
        }
    }

    return results;
};

const isCodeFile = (filename, includeTests) => {
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
};

const generateAIDocumentation = async (files, repoMetadata) => {
    try {
        const prompt = `You are an expert technical documentation analyzer. Analyze the repository: ${repoMetadata.full_name}

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
    "score": 85,
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
IMPORTANT: For best practices Keep the response phrases as short as possible.`;

        const response = await callGemini({
            prompt: prompt,
            model: config.gemini.model,
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
};

const repairIncompleteJson = (rawResponse) => {
    let jsonStr = rawResponse.trim()
        .replace(/^\`\`\`(json)?/g, '')
        .replace(/\`\`\`$/g, '')
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
};

const callGemini = async ({ prompt, model }) => {
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.gemini.apiKey}`;

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
};

module.exports = {
    processRepositoryContents,
    generateAIDocumentation,
    isCodeFile
};
