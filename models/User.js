const mongoose = require('mongoose');
const crypto = require('crypto');
const { encrypt, decrypt } = require('../utils/encryption');

const userSchema = new mongoose.Schema({
    githubId: {
        type: String,
        required: true,
        unique: true
    },
    accessToken: {
        type: String,
        required: true,
        set: encrypt,
        get: decrypt
    },
    credits: {
        type: Number,
        default: 200
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    lastLogin: Date
});

const User = mongoose.model('User', userSchema);

module.exports = User;