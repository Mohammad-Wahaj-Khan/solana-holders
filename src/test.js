// src/test.js
// Test script to verify API connection and single token fetch

const config = require('../config/config');
const logger = require('./utils/logger');
const TokenService = require('./services/tokenService');
const RateLimiter = require('./services/rateLimiter');
const HolderFetcher = require('./services/holderFetcher');

async function testApiConnection() {
    console.log('\n🧪 Testing API Connection...');
    const tokenService = new TokenService();
    
    try {
        const tokens = await tokenService.fetchTokens();
        console.log(`✅ API connected! Found ${tokens.length} tokens`);
        console.log(`   First 5 tokens: ${tokens.slice(0, 5).join(', ')}`);
        return tokens;
    } catch (error) {
        console.error(`❌ API connection failed: ${error.message}`);
        return null;
    }
}

async function testSingleTokenFetch() {
    console.log('\n🧪 Testing Single Token Holder Fetch...');
    
    const testToken = 'So11111111111111111111111111111111111111112'; // SOL token
    const rpcUrl = config.rpcEndpoints[0].url;
    const rpcName = config.rpcEndpoints[0].name;
    
    const rateLimiter = new RateLimiter(1); // 1 request per second for test
    const fetcher = new HolderFetcher(rpcUrl, rpcName, rateLimiter, true);
    
    console.log(`   Testing token: ${testToken}`);
    console.log(`   Using RPC: ${rpcName}`);
    
    try {
        const result = await fetcher.fetchHolders(testToken, 100);
        if (result.success) {
            console.log(`✅ Success! Found ${result.holderCount} holders`);
            console.log(`   First 3 holders:`, result.holders.slice(0, 3));
        } else {
            console.log(`❌ Failed: ${result.error}`);
        }
        return result;
    } catch (error) {
        console.error(`❌ Test failed: ${error.message}`);
        return null;
    }
}

async function runTests() {
    console.log('🔬 Running Tests');
    console.log('='.repeat(50));
    
    const tokens = await testApiConnection();
    if (tokens && tokens.length > 0) {
        await testSingleTokenFetch();
    }
    
    console.log('\n✅ Tests complete!');
}

runTests();