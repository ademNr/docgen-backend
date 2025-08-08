const {
    processRepositoryContents,
    generateAIDocumentation
} = require('../utils/docsGenerator');
const User = require('../models/User');

const generateDocsService = async ({ user, token, owner, repo, includeTests }) => {
    const defaultCost = 1;

    try {
        const hasLifetimePlan = user.lifeTimePlan;
        const cost = hasLifetimePlan ? 0 : defaultCost;

        // Check credits (don't deduct yet)
        if (!hasLifetimePlan && user.credits < cost) {
            throw new Error('Insufficient credits');
        }

        // Generate documentation
        const { Octokit } = await import('@octokit/rest');
        const octokit = new Octokit({
            auth: token,
            request: { timeout: 30000 }
        });

        const repoData = await octokit.repos.get({ owner, repo });
        const defaultBranch = repoData.data.default_branch;

        const { data: contents } = await octokit.repos.getContent({
            owner,
            repo,
            ref: defaultBranch,
            path: ''
        });

        const codeFiles = await processRepositoryContents(
            octokit,
            owner,
            repo,
            contents,
            includeTests,
            ''
        );

        const documentation = await generateAIDocumentation(codeFiles, repoData.data);

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

        return {
            documentation,
            credits: user.credits,
            lifeTimePlan: user.lifeTimePlan
        };

    } catch (error) {
        throw error;
    }
};

module.exports = {
    generateDocsService
};
