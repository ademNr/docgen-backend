const axios = require('axios');
const User = require('../models/User');
const config = require('../config');

const githubAuthService = async (code) => {
    try {
        // Exchange code for access token
        const response = await axios.post(
            'https://github.com/login/oauth/access_token',
            {
                client_id: config.github.clientId,
                client_secret: config.github.clientSecret,
                code,
            },
            {
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'DocsGen-App'
                },
                timeout: 10000
            }
        );

        console.log('GitHub OAuth Response:', {
            hasToken: !!response.data.access_token,
            tokenType: response.data.token_type,
            scope: response.data.scope
        });

        if (!response.data.access_token) {
            console.error('GitHub OAuth Error:', response.data);
            throw new Error('GitHub authentication failed: No access token received');
        }

        // Get GitHub user info with better error handling
        const userResponse = await axios.get('https://api.github.com/user', {
            headers: {
                Authorization: `Bearer ${response.data.access_token}`, // Use Bearer
                Accept: 'application/vnd.github.v3+json',
                'User-Agent': 'DocsGen-App'
            },
            timeout: 10000
        });

        const githubUser = userResponse.data;
        console.log('GitHub User Info:', {
            id: githubUser.id,
            login: githubUser.login,
            email: githubUser.email
        });

        // Find or create user
        let user = await User.findOne({ githubId: githubUser.id });

        if (!user) {
            user = new User({
                githubId: githubUser.id,
                login: githubUser.login,
                email: githubUser.email, // Store email if available
                accessToken: response.data.access_token,
                credits: 1
            });
        } else {
            // Update existing user
            user.accessToken = response.data.access_token;
            user.lastLogin = new Date();
            if (githubUser.email && !user.email) {
                user.email = githubUser.email;
            }
        }

        await user.save();

        return {
            token: response.data.access_token,
            credits: user.credits,
            userId: githubUser.id,
            isSubscribed: user.lifeTimePlan,
            userInfo: {
                login: githubUser.login,
                email: githubUser.email,
                avatar_url: githubUser.avatar_url
            }
        };

    } catch (error) {
        console.error('GitHub Auth Service Error:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
        });

        if (error.response?.status === 401) {
            throw new Error('Invalid GitHub authorization code');
        } else if (error.response?.status === 403) {
            throw new Error('GitHub API rate limit exceeded');
        } else {
            throw new Error(`GitHub authentication failed: ${error.message}`);
        }
    }
};

module.exports = {
    githubAuthService
};
