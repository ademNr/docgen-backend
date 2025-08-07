const User = require('../models/User');

const processGumroadWebhook = async (event) => {
    // Validate required fields
    if (!event.product_name || !event.email || !event.sale_id) {
        throw new Error('Invalid payload');
    }

    // Normalize product name for case-insensitive matching
    const productName = event.product_name.trim().toLowerCase();

    // Handle lifetime subscription
    if (productName === "🚀 lifetime gitforje subscription") {
        console.log(`Processing lifetime subscription for: ${event.email}`);

        const result = await User.updateOne(
            { email: event.email },
            { $set: { lifeTimePlan: true } },
            { runValidators: false } // Skip validation
        );

        if (result.matchedCount === 0) {
            throw new Error('User not found');
        }

        const user = await User.findOne({ email: event.email });
        console.log(`Updated user ${user.githubId} with lifetime access`);
        return { success: true, message: 'Lifetime access granted' };
    }

    // Handle credit purchases
    let creditsToAdd = 0;

    if (productName === "5 credits") {
        creditsToAdd = 5;
    } else if (productName === "15 credits") {
        creditsToAdd = 15;
    } else if (productName === "30 credits") {
        creditsToAdd = 30;
    }

    // Process valid credit products
    if (creditsToAdd > 0) {
        const quantity = event.quantity ? parseInt(event.quantity) : 1;
        const totalCredits = creditsToAdd * quantity;

        console.log(`Adding ${totalCredits} credits to: ${event.email}`);

        const result = await User.updateOne(
            { email: event.email },
            { $inc: { credits: totalCredits } },
            { runValidators: false } // Skip validation
        );

        if (result.matchedCount === 0) {
            throw new Error('User not found');
        }

        const user = await User.findOne({ email: event.email });
        console.log(`Added ${totalCredits} credits to ${user.githubId}. New balance: ${user.credits}`);
        return { success: true, message: `Added ${totalCredits} credits` };
    }

    // Unrecognized product type
    console.log(`Unprocessed product: ${event.product_name} for ${event.email}`);
    return { success: true, message: 'Event received but not processed' };
};

module.exports = {
    processGumroadWebhook
};
