// config/config.js
// Configuration file for RPC endpoints and settings

require('dotenv').config();

const heliusRpcEndpoints = Array.from({ length: 10 }, (_, index) => {
    const number = index + 1;
    return {
        name: `Helius ${number}`,
        url: process.env[`HELIUS_RPC_${number}`] || 'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY',
        type: 'rpc'
    };
});

module.exports = {
    // Multiple RPC endpoints for load balancing
    // Sign up for free API keys at each provider
    rpcEndpoints: [
        ...heliusRpcEndpoints,
        {
            name: 'Helius DAS',
            url: process.env.HELIUS_DAS || 'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY',
            type: 'das'  // For DAS API specifically
        }
    ],
    
    // How many tokens per RPC worker
    tokensPerRpc: 5,
    holderExportConcurrency: 50,
    
    // Rate limiting (requests per second)
    rateLimits: {
        rpc: 8,      // 8 requests per second for regular RPC
        das: 2,      // 2 requests per second for DAS API
    },
    
    // API endpoint to fetch tokens
    tokenApiUrl: 'http://localhost:8003/tokens?chain=solana',
    tokenCsvPath: './data/tokens.csv',
    
    // Output settings
    outputDir: './data',
    logsDir: './logs',
    
    // Processing settings
    maxRetries: 3,
    retryDelayMs: 2000,
    
    // Holder fetch settings
    maxHoldersPerToken: 10000,  // Legacy worker limit; CSV exporter is unlimited unless MAX_HOLDERS_PER_TOKEN is set.
    holderPageSize: 1000,       // Holders per API page
};

// Validate required environment variables
const requiredEnvVars = [
    'HELIUS_RPC_1',
    'HELIUS_RPC_2',
    'HELIUS_RPC_3',
    'HELIUS_RPC_4',
    'HELIUS_RPC_5',
    'HELIUS_RPC_6',
    'HELIUS_RPC_7',
    'HELIUS_RPC_8',
    'HELIUS_RPC_9',
    'HELIUS_RPC_10',
    'HELIUS_DAS'
];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.warn(`⚠️ Warning: Missing environment variables: ${missingVars.join(', ')}`);
    console.warn('Create a .env file with your API keys');
}
