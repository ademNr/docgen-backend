const axios = require('axios');
const User = require('../models/User');

const getUserCreditsService = async (user) => {
    return {
        credits: user.credits,
        lastLogin: user.lastLogin,
        isSubscribed: user.lifeTimePlan
    };
};

const getUserReposService = async (token) => {
    try {
        // First, let's verify the token by checking user info
        const userResponse = await axios.get('https://api.github.com/user', {
            headers: {
                Authorization: `Bearer ${token}`, // Use Bearer instead of token
                Accept: 'application/vnd.github.v3+json',
                'User-Agent': 'DocsGen-App'
            },
            timeout: 10000
        });

        console.log('GitHub user verified:', userResponse.data.login);

        // Now fetch repositories
        const response = await axios.get('https://api.github.com/user/repos', {
            headers: {
                Authorization: `Bearer ${token}`, // Use Bearer instead of token
                Accept: 'application/vnd.github.v3+json',
                'User-Agent': 'DocsGen-App'
            },
            params: {
                sort: 'updated',
                direction: 'desc',
                per_page: 100,
                type: 'all' // Include all repo types
            },
            timeout: 15000
        });

        return response.data.map(repo => ({
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
            default_branch: repo.default_branch,
            private: repo.private
        }));

    } catch (error) {
        console.error('GitHub API Error Details:', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            headers: error.response?.headers,
            message: error.message
        });

        // Handle specific GitHub API errors
        if (error.response?.status === 401) {
            throw new Error('GitHub token is invalid or expired. Please re-authenticate.');
        } else if (error.response?.status === 403) {
            const resetTime = error.response.headers['x-ratelimit-reset'];
            const resetDate = resetTime ? new Date(resetTime * 1000).toISOString() : 'unknown';
            throw new Error(`GitHub API rate limit exceeded. Resets at: ${resetDate}`);
        } else if (error.response?.status === 404) {
            throw new Error('GitHub API endpoint not found. Please check your permissions.');
        } else if (error.code === 'ECONNABORTED') {
            throw new Error('GitHub API request timed out. Please try again.');
        } else {
            throw new Error(`GitHub API error: ${error.response?.data?.message || error.message}`);
        }
    }
};

const updateUserEmailService = async (userId, email) => {
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        throw new Error('Invalid email format');
    }

    // Use updateOne to avoid validation issues with required fields
    const result = await User.updateOne(
        { githubId: userId },
        { email: email },
        { runValidators: true } // Only validate the fields being updated
    );

    if (result.matchedCount === 0) {
        throw new Error('User not found');
    }

    return {
        message: 'Email updated successfully',
        email: email
    };
};

module.exports = {
    getUserCreditsService,
    getUserReposService,
    updateUserEmailService
};
