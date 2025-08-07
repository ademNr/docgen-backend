const crypto = require('crypto');

const createJobId = (owner, repo, token) => {
    return crypto.createHash('sha256').update(`${owner}${repo}${token}`).digest('hex');
};

const getRelativePath = (fullPath, basePath) => {
    return basePath ? fullPath.replace(basePath + '/', '') : fullPath;
};

module.exports = {
    createJobId,
    getRelativePath
};
