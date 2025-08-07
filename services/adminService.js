const User = require('../models/User');

const addCreditsService = async (githubId, amount) => {
    // Use updateOne to avoid validation issues
    const result = await User.updateOne(
        { githubId: githubId },
        { $inc: { credits: parseInt(amount) } },
        { runValidators: false } // Skip validation since we're only updating credits
    );

    if (result.matchedCount === 0) {
        throw new Error('User not found');
    }

    // Get updated user data
    const user = await User.findOne({ githubId: githubId });

    return {
        githubId,
        newCredits: user.credits
    };
};

module.exports = {
    addCreditsService
};
