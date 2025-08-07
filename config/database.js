const mongoose = require('mongoose');

let cachedConnection = null;
let connectionPromise = null;

const connectToDatabase = async () => {
    // If we have a cached connection and it's ready, return it
    if (cachedConnection && cachedConnection.readyState === 1) {
        return cachedConnection;
    }

    // If we're already connecting, return the existing promise
    if (connectionPromise) {
        return connectionPromise;
    }

    // Create new connection promise
    connectionPromise = createConnection();

    try {
        cachedConnection = await connectionPromise;
        return cachedConnection;
    } catch (error) {
        // Reset promise on error so we can retry
        connectionPromise = null;
        throw error;
    }
};

const createConnection = async () => {
    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI environment variable is not defined');
    }

    // Updated options for modern MongoDB driver compatibility
    const options = {
        // Connection options
        maxPoolSize: 5, // Maintain up to 5 socket connections
        serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
        socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
        family: 4, // Use IPv4, skip trying IPv6

        // Serverless optimizations
        maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
        heartbeatFrequencyMS: 10000, // Heartbeat every 10 seconds

        // Removed deprecated options:
        // - useNewUrlParser (default in newer versions)
        // - useUnifiedTopology (default in newer versions)
        // - bufferCommands (handled differently now)
        // - bufferMaxEntries (deprecated)
        // - connectTimeoutMS (use serverSelectionTimeoutMS instead)
    };

    try {
        const connection = await mongoose.connect(process.env.MONGODB_URI, options);

        // Handle connection events
        connection.connection.on('connected', () => {
            console.log('MongoDB connected successfully');
        });

        connection.connection.on('error', (err) => {
            console.error('MongoDB connection error:', err);
            cachedConnection = null;
            connectionPromise = null;
        });

        connection.connection.on('disconnected', () => {
            console.log('MongoDB disconnected');
            cachedConnection = null;
            connectionPromise = null;
        });

        // Handle process termination
        process.on('SIGINT', async () => {
            if (cachedConnection) {
                await cachedConnection.connection.close();
                console.log('MongoDB connection closed through app termination');
                process.exit(0);
            }
        });

        return connection;
    } catch (err) {
        console.error('MongoDB connection error:', err);
        cachedConnection = null;
        connectionPromise = null;
        throw err;
    }
};

// Graceful shutdown for non-serverless environments
const closeConnection = async () => {
    if (cachedConnection) {
        await cachedConnection.connection.close();
        cachedConnection = null;
        connectionPromise = null;
        console.log('MongoDB connection closed');
    }
};

// Health check function
const checkConnection = () => {
    if (cachedConnection) {
        return {
            status: 'connected',
            readyState: cachedConnection.connection.readyState,
            host: cachedConnection.connection.host,
            name: cachedConnection.connection.name
        };
    }
    return {
        status: 'disconnected',
        readyState: 0
    };
};

module.exports = {
    connectToDatabase,
    closeConnection,
    checkConnection
};
