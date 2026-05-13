// config/config.js
// Configuration file for RPC endpoints and settings

require('dotenv').config();

module.exports = {
    // Multiple RPC endpoints for load balancing
    // Sign up for free API keys at each provider
    rpcEndpoints: [
        {
            name: 'Helius 1',
            url: process.env.HELIUS_RPC_1 || 'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY',
            type: 'rpc'
        },
        {
            name: 'Helius 2',
            url: process.env.HELIUS_RPC_2 || 'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY',
            type: 'rpc'
        },
        {
            name: 'Helius 3',
            url: process.env.HELIUS_RPC_3 || 'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY',
            type: 'rpc'
        },
        {
            name: 'Helius 4',
            url: process.env.HELIUS_RPC_4 || 'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY',
            type: 'rpc'
        },
        {
            name: 'Public Solana',
            url: 'https://api.mainnet-beta.solana.com',
            type: 'rpc'
        },
        {
            name: 'Triton',
            url: process.env.TRITON_RPC || 'https://rpc.triton.one/solana',
            type: 'rpc'
        },
        {
            name: 'Helius DAS',
            url: process.env.HELIUS_DAS || 'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY',
            type: 'das'  // For DAS API specifically
        }
    ],
    
    // How many tokens per RPC worker
    tokensPerRpc: 5,
    
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
    maxHoldersPerToken: 10000,  // Limit holders per token to save memory
    holderPageSize: 1000,       // Holders per API page
};

// Validate required environment variables
const requiredEnvVars = ['HELIUS_RPC_1', 'HELIUS_RPC_2', 'HELIUS_RPC_3', 'HELIUS_RPC_4', 'HELIUS_DAS'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.warn(`⚠️ Warning: Missing environment variables: ${missingVars.join(', ')}`);
    console.warn('Create a .env file with your API keys');
}
