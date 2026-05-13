// src/workers/tokenProcessor.js
// Processes a batch of token mints against a single RPC endpoint.

const config = require('../../config/config');
const logger = require('../utils/logger');
const HolderFetcher = require('../services/holderFetcher');

class TokenProcessor {
    constructor(rpc, rateLimiter, tokens, workerId) {
        this.rpc = rpc;
        this.rateLimiter = rateLimiter;
        this.tokens = tokens;
        this.workerId = workerId;
        this.fetcher = new HolderFetcher(
            rpc.url,
            rpc.name,
            rateLimiter,
            rpc.type === 'das'
        );
    }

    async processToken(tokenMint) {
        let lastResult = null;

        for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
            const result = await this.fetcher.fetchHolders(
                tokenMint,
                config.maxHoldersPerToken
            );

            if (result.success) {
                if (attempt > 1) {
                    logger.info(`[Worker ${this.workerId}] ${tokenMint} succeeded on attempt ${attempt}`);
                }
                return result;
            }

            lastResult = result;

            if (attempt < config.maxRetries) {
                logger.warn(
                    `[Worker ${this.workerId}] Retrying ${tokenMint} after attempt ${attempt}: ${result.error}`
                );
                await new Promise(resolve => setTimeout(resolve, config.retryDelayMs));
            }
        }

        return lastResult;
    }

    async process() {
        const startTime = Date.now();
        const results = [];

        logger.info(
            `[Worker ${this.workerId}] Starting ${this.tokens.length} tokens on ${this.rpc.name}`
        );

        for (const tokenMint of this.tokens) {
            const result = await this.processToken(tokenMint);
            results.push(result);

            if (result.success) {
                logger.info(
                    `[Worker ${this.workerId}] ${tokenMint}: ${result.holderCount} holders`
                );
            }
        }

        const duration = (Date.now() - startTime) / 1000;
        const successful = results.filter(result => result.success).length;

        logger.info(
            `[Worker ${this.workerId}] Finished ${successful}/${this.tokens.length} tokens on ${this.rpc.name} in ${duration.toFixed(2)}s`
        );

        return {
            workerId: this.workerId,
            rpcName: this.rpc.name,
            rpcUrl: this.rpc.url,
            duration,
            successful,
            total: this.tokens.length,
            results,
            stats: this.fetcher.getStats()
        };
    }
}

module.exports = TokenProcessor;
