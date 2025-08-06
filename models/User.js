const mongoose = require('mongoose');
const crypto = require('crypto');
const { encrypt, decrypt } = require('../utils/encryption');

const userSchema = new mongoose.Schema({
    githubId: {
        type: String,
        required: true,
        unique: true
    },
    lifeTimePlan: {
        type: Boolean,
        default: false
    },
    login: { type: String, required: true }, // GitHub username
    email: { type: String, default: "" }, // GitHub email
    accessToken: {
        type: String,
        required: true,
        set: encrypt,
        get: decrypt
    },
    credits: {
        type: Number,
        default: 1
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    lastLogin: Date
});

const User = mongoose.model('User', userSchema);

module.exports = User;