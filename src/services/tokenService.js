// src/services/tokenService.js
// Fetch tokens from CSV or API

const fs = require('fs');
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../../config/config');

function parseCsvLine(line) {
    const values = [];
    let value = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const next = line[i + 1];

        if (char === '"' && inQuotes && next === '"') {
            value += '"';
            i++;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            values.push(value);
            value = '';
        } else {
            value += char;
        }
    }

    values.push(value);
    return values;
}

function errorMessage(error) {
    if (error.response?.data?.error) {
        const rpcError = error.response.data.error;
        return `${rpcError.message || 'API error'} (${rpcError.code || 'unknown'})`;
    }

    if (error.response?.status) {
        return `HTTP ${error.response.status}: ${JSON.stringify(error.response.data || {})}`;
    }

    return error.message || String(error);
}

class TokenService {
    constructor() {
        this.tokens = [];
    }

    fetchTokensFromCsv(csvPath = config.tokenCsvPath) {
        logger.info(`Reading tokens from CSV: ${csvPath}`);

        const content = fs.readFileSync(csvPath, 'utf8');
        const lines = content.split(/\r?\n/).filter(line => line.trim());

        if (lines.length <= 1) {
            this.tokens = [];
            return this.tokens;
        }

        const headers = parseCsvLine(lines[0]);
        const mintIndex = headers.findIndex(header => (
            header === 'mint' || header === 'address' || header === 'tokenAddress'
        ));

        if (mintIndex === -1) {
            throw new Error(`CSV is missing a mint/address/tokenAddress column: ${csvPath}`);
        }

        this.tokens = lines
            .slice(1)
            .map(line => parseCsvLine(line)[mintIndex])
            .filter(Boolean);

        this.tokens = [...new Set(this.tokens)];
        logger.info(`Successfully loaded ${this.tokens.length} unique tokens from CSV`);
        return this.tokens;
    }

    // Fetch all tokens from API
    async fetchTokens() {
        if (fs.existsSync(config.tokenCsvPath)) {
            return this.fetchTokensFromCsv(config.tokenCsvPath);
        }

        try {
            logger.info(`Fetching tokens from: ${config.tokenApiUrl}`);
            
            const response = await axios.get(config.tokenApiUrl, {
                timeout: 30000,
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            // Handle different response formats
            let tokens = [];
            if (Array.isArray(response.data)) {
                tokens = response.data;
            } else if (response.data.tokens && Array.isArray(response.data.tokens)) {
                tokens = response.data.tokens;
            } else if (response.data.data && Array.isArray(response.data.data)) {
                tokens = response.data.data;
            } else {
                logger.warn('Unexpected API response format', { data: response.data });
                tokens = [];
            }
            
            // Extract mint addresses (handle different formats)
            this.tokens = tokens.map(token => {
                if (typeof token === 'string') return token;
                if (token.mint) return token.mint;
                if (token.address) return token.address;
                if (token.tokenAddress) return token.tokenAddress;
                logger.warn('Unknown token format', { token });
                return null;
            }).filter(t => t !== null);
            
            // Remove duplicates
            this.tokens = [...new Set(this.tokens)];
            
            logger.info(`Successfully fetched ${this.tokens.length} unique tokens`);
            return this.tokens;
            
        } catch (error) {
            logger.error(`Failed to fetch tokens: ${errorMessage(error)}`);
            throw error;
        }
    }
    
    getTokens() {
        return this.tokens;
    }
    
    getTokenCount() {
        return this.tokens.length;
    }
}

module.exports = TokenService;
