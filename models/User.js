const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    githubId: {
        type: Number,
        required: true,
        unique: true
        // Removed index: true to avoid duplicate with schema.index() below
    },
    login: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    email: {
        type: String,
        trim: true,
        lowercase: true,
        maxlength: 254,
        validate: {
            validator: function (v) {
                return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
            },
            message: 'Invalid email format'
        },
        default: ""
    },
    accessToken: {
        type: String,
        required: true,
        select: false // Don't include in queries by default
    },
    credits: {
        type: Number,
        default: 1,
        min: 0,
        max: 10000
    },
    lifeTimePlan: {
        type: Boolean,
        default: false
    },
    lastLogin: {
        type: Date,
        default: Date.now
    },
    isActive: {
        type: Boolean,
        default: true
    },
    loginAttempts: {
        type: Number,
        default: 0
    },
    lockUntil: Date
}, {
    timestamps: true,
    toJSON: {
        transform: function (doc, ret) {
            delete ret.accessToken;
            delete ret.__v;
            return ret;
        }
    }
});

// Indexes for better performance (removed duplicate githubId index)
userSchema.index({ githubId: 1 }, { unique: true });
userSchema.index({ email: 1 });
userSchema.index({ createdAt: 1 });
userSchema.index({ lastLogin: 1 });

// Virtual for account lock status
userSchema.virtual('isLocked').get(function () {
    return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Pre-save middleware to hash sensitive data
userSchema.pre('save', async function (next) {
    // Only hash if accessToken is modified
    if (this.isModified('accessToken')) {
        // In production, you might want to encrypt the token instead of hashing
        // For now, we'll keep it as is for GitHub API calls
    }
    next();
});

// Method to increment login attempts
userSchema.methods.incLoginAttempts = function () {
    // If we have a previous lock that has expired, restart at 1
    if (this.lockUntil && this.lockUntil < Date.now()) {
        return this.updateOne({
            $unset: { lockUntil: 1 },
            $set: { loginAttempts: 1 }
        });
    }

    const updates = { $inc: { loginAttempts: 1 } };

    // Lock account after 5 failed attempts for 2 hours
    if (this.loginAttempts + 1 >= 5 && !this.isLocked) {
        updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 };
    }

    return this.updateOne(updates);
};

// Static method to find user and validate
userSchema.statics.getAuthenticated = function (githubId, callback) {
    this.findOne({ githubId: githubId }, function (err, user) {
        if (err) return callback(err);

        // Make sure the user exists
        if (!user) {
            return callback(null, null, 'User not found');
        }

        // Check if the account is currently locked
        if (user.isLocked) {
            return user.incLoginAttempts(function (err) {
                if (err) return callback(err);
                return callback(null, null, 'Account temporarily locked');
            });
        }

        return callback(null, user);
    });
};

module.exports = mongoose.model('User', userSchema);
