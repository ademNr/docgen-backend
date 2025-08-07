const EventEmitter = require('events');
const {
    processRepositoryContents,
    generateAIDocumentation
} = require('../utils/docsGenerator');
const { createJobId } = require('../utils/helpers');
const User = require('../models/User');

const progressChannels = {};
const processingJobs = new Map();

const getProgressEmitter = (jobId) => {
    if (!progressChannels[jobId]) {
        progressChannels[jobId] = new EventEmitter();
    }
    return progressChannels[jobId];
};

const removeProgressEmitter = (jobId) => {
    delete progressChannels[jobId];
    processingJobs.delete(jobId);
};

const emitProgress = (jobId, progress, message, currentFile = null) => {
    const emitter = getProgressEmitter(jobId);
    const progressData = {
        progress,
        message,
        currentFile,
        timestamp: new Date().toISOString()
    };

    console.log(`📊 Emitting progress for jobId ${jobId}:`, progressData);
    console.log(`📻 Emitter has ${emitter.listenerCount('progress')} listeners`);

    emitter.emit('progress', progressData);
};

const generateDocsService = async ({ user, token, owner, repo, includeTests }) => {
    const defaultCost = 1;
    const jobId = createJobId(owner, repo, token);

    // Check if job is already processing
    if (processingJobs.has(jobId)) {
        return new Promise((resolve, reject) => {
            const emitter = getProgressEmitter(jobId);
            emitter.once('completed', resolve);
            emitter.once('failed', reject);
            setTimeout(() => reject(new Error('Documentation generation timeout')), 120000);
        });
    }

    processingJobs.set(jobId, { startTime: Date.now() });

    try {
        const hasLifetimePlan = user.lifeTimePlan;
        const cost = hasLifetimePlan ? 0 : defaultCost;

        // Check credits (don't deduct yet)
        if (!hasLifetimePlan && user.credits < cost) {
            emitProgress(jobId, -1, 'Insufficient credits');
            throw new Error('Insufficient credits');
        }

        emitProgress(jobId, 5, 'Starting documentation generation...');

        // Generate documentation
        const { Octokit } = await import('@octokit/rest');
        const octokit = new Octokit({
            auth: token,
            request: { timeout: 30000 }
        });

        emitProgress(jobId, 10, 'Fetching repository metadata...');
        const repoData = await octokit.repos.get({ owner, repo });
        const defaultBranch = repoData.data.default_branch;

        emitProgress(jobId, 20, 'Discovering repository structure...');
        const { data: contents } = await octokit.repos.getContent({
            owner,
            repo,
            ref: defaultBranch,
            path: ''
        });

        emitProgress(jobId, 30, 'Starting file analysis...');
        const codeFiles = await processRepositoryContents(
            octokit,
            owner,
            repo,
            contents,
            includeTests,
            '',
            jobId,
            emitProgress
        );

        emitProgress(jobId, 60, 'Generating documentation with AI...');
        const documentation = await generateAIDocumentation(codeFiles, repoData.data);

        emitProgress(jobId, 90, 'Documentation generated successfully!');

        // Deduct credits only after successful generation
        if (!hasLifetimePlan) {
            const result = await User.findOneAndUpdate(
                {
                    githubId: user.githubId,
                    credits: { $gte: cost }
                },
                { $inc: { credits: -cost } },
                { new: true }
            );

            if (!result) {
                throw new Error('Failed to deduct credits - insufficient balance');
            }

            user.credits = result.credits;
        }

        emitProgress(jobId, 100, 'Documentation ready');

        const result = {
            documentation,
            credits: user.credits,
            lifeTimePlan: user.lifeTimePlan
        };

        // Notify waiting requests
        const emitter = getProgressEmitter(jobId);
        emitter.emit('completed', result);

        return result;

    } catch (error) {
        emitProgress(jobId, -1, `Error: ${error.message}`);

        const emitter = getProgressEmitter(jobId);
        emitter.emit('failed', error);

        throw error;
    } finally {
        processingJobs.delete(jobId);
    }
};

module.exports = {
    generateDocsService,
    getProgressEmitter,
    removeProgressEmitter
};
