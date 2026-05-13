// src/services/holderFetcher.js
// Fetch holders for a given token using RPC

const axios = require('axios');
const logger = require('../utils/logger');

class HolderFetcher {
    constructor(rpcUrl, rpcName, rateLimiter, isDasApi = false) {
        this.rpcUrl = rpcUrl;
        this.rpcName = rpcName;
        this.rateLimiter = rateLimiter;
        this.isDasApi = isDasApi;
        this.requestCount = 0;
        this.errorCount = 0;
    }
    
    // Fetch holders for a single token
    async fetchHolders(tokenMint, maxHolders = 10000) {
        const startTime = Date.now();
        
        try {
            // Apply rate limiting before request
            await this.rateLimiter.wait();
            this.requestCount++;
            
            const holders = await this.fetchWithPagination(tokenMint, maxHolders);
            
            const duration = Date.now() - startTime;
            logger.debug(`[${this.rpcName}] Fetched ${holders.length} holders for ${tokenMint} in ${duration}ms`);
            
            return {
                success: true,
                tokenMint,
                holderCount: holders.length,
                holders: holders,
                rpcUsed: this.rpcName,
                duration
            };
            
        } catch (error) {
            this.errorCount++;
            logger.error(`[${this.rpcName}] Failed to fetch holders for ${tokenMint}: ${error.message}`);
            
            return {
                success: false,
                tokenMint,
                error: error.message,
                rpcUsed: this.rpcName,
                duration: Date.now() - startTime
            };
        }
    }
    
    // Fetch holders with pagination (handles large holder counts)
    async fetchWithPagination(tokenMint, maxHolders) {
        const allHolders = [];
        let page = 1;
        let hasMore = true;
        
        while (hasMore && allHolders.length < maxHolders) {
            const response = await this.makeRpcCall(tokenMint, page);
            
            if (!response || !response.result) {
                hasMore = false;
                break;
            }
            
            const tokenAccounts = response.result.token_accounts || [];
            
            if (tokenAccounts.length === 0) {
                hasMore = false;
                break;
            }
            
            // Extract holder information
            tokenAccounts.forEach(account => {
                if (allHolders.length < maxHolders) {
                    allHolders.push({
                        owner: account.owner,
                        tokenAccount: account.address,
                        balance: account.amount || account.balance,
                        decimals: account.decimals
                    });
                }
            });
            
            // Check if we've reached the last page
            if (tokenAccounts.length < 1000) {
                hasMore = false;
            }
            
            page++;
            
            // Small delay between pages to avoid rate limits
            if (hasMore) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        return allHolders;
    }
    
    // Make individual RPC call
    async makeRpcCall(tokenMint, page) {
        // Use DAS API getTokenAccounts method
        const requestBody = {
            jsonrpc: '2.0',
            id: `holder-${tokenMint.substring(0, 8)}-${page}`,
            method: 'getTokenAccounts',
            params: {
                page: page,
                limit: 1000,
                mint: tokenMint,
                displayOptions: {
                    showZeroBalance: false
                }
            }
        };
        
        try {
            const response = await axios.post(this.rpcUrl, requestBody, {
                timeout: 30000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            return response.data;
            
        } catch (error) {
            // Fallback to standard getProgramAccounts if DAS fails
            if (error.response?.status === 400 || error.response?.data?.error?.code === -32601) {
                return await this.fallbackRpcCall(tokenMint);
            }
            throw error;
        }
    }
    
    // Fallback method using getProgramAccounts
    async fallbackRpcCall(tokenMint) {
        const requestBody = {
            jsonrpc: '2.0',
            id: 'holder-fallback',
            method: 'getProgramAccounts',
            params: [
                'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                {
                    encoding: 'jsonParsed',
                    filters: [
                        { dataSize: 165 },
                        {
                            memcmp: {
                                offset: 0,
                                bytes: tokenMint
                            }
                        }
                    ]
                }
            ]
        };
        
        const response = await axios.post(this.rpcUrl, requestBody, {
            timeout: 30000
        });
        
        // Transform response to match DAS format
        const accounts = response.data.result || [];
        return {
            result: {
                token_accounts: accounts.map(acc => ({
                    address: acc.pubkey,
                    owner: acc.account.data.parsed.info.owner,
                    amount: acc.account.data.parsed.info.tokenAmount.amount,
                    decimals: acc.account.data.parsed.info.tokenAmount.decimals
                }))
            }
        };
    }
    
    getStats() {
        return {
            rpcName: this.rpcName,
            requests: this.requestCount,
            errors: this.errorCount,
            successRate: this.requestCount > 0 
                ? ((this.requestCount - this.errorCount) / this.requestCount * 100).toFixed(2)
                : 0
        };
    }
}

module.exports = HolderFetcher;