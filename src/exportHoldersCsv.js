// src/exportHoldersCsv.js
// Stable, resumable holder exporter for one or more token source CSV files.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const axios = require('axios');
const config = require('../config/config');
const RateLimiter = require('./services/rateLimiter');

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const PAGE_SIZE = Number(process.env.HOLDER_PAGE_SIZE || config.holderPageSize || 1000);
const CONCURRENCY = Number(process.env.HOLDER_EXPORT_CONCURRENCY || 3);
const TOKEN_LIMIT = Number(process.env.TOKEN_LIMIT || 0);
const MAX_HOLDERS_PER_TOKEN = Number(process.env.MAX_HOLDERS_PER_TOKEN || 0);
const STABLE_BASENAME = process.env.HOLDER_EXPORT_BASENAME || 'all_token_holders';

function outputFiles() {
    return {
        holders: path.join(config.outputDir, `${STABLE_BASENAME}.csv`),
        summary: path.join(config.outputDir, `${STABLE_BASENAME}_summary.csv`),
        errors: path.join(config.outputDir, `${STABLE_BASENAME}_errors.csv`),
        manifest: path.join(config.outputDir, `${STABLE_BASENAME}_manifest.json`),
        checkpoint: path.join(config.outputDir, `${STABLE_BASENAME}_checkpoint.json`)
    };
}

function isGeneratedCsv(fileName) {
    return (
        /^token_holders/i.test(fileName) ||
        /^all_token_holders/i.test(fileName) ||
        /holder/i.test(fileName) ||
        /summary/i.test(fileName) ||
        /errors/i.test(fileName) ||
        /manifest/i.test(fileName) ||
        /checkpoint/i.test(fileName) ||
        /corrupt/i.test(fileName)
    );
}

function listDefaultInputFiles() {
    if (!fs.existsSync(config.outputDir)) return [];

    return fs.readdirSync(config.outputDir)
        .filter(file => file.toLowerCase().endsWith('.csv'))
        .filter(file => !isGeneratedCsv(file))
        .map(file => path.join(config.outputDir, file))
        .sort();
}

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

function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (/[",\r\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function csvRow(values) {
    return `${values.map(csvEscape).join(',')}\n`;
}

function errorMessage(error) {
    if (error.response?.data?.error) {
        const rpcError = error.response.data.error;
        return `${rpcError.message || 'RPC error'} (${rpcError.code || 'unknown'})`;
    }

    if (error.response?.status) {
        return `HTTP ${error.response.status}: ${JSON.stringify(error.response.data || {})}`;
    }

    return error.message || String(error);
}

function addBigIntStrings(a, b) {
    try {
        return (BigInt(a || '0') + BigInt(b || '0')).toString();
    } catch {
        return String(a || b || '');
    }
}

function aggregateHoldersByOwner(holders) {
    const byOwner = new Map();

    for (const holder of holders) {
        if (!holder.owner) continue;

        const existing = byOwner.get(holder.owner);
        if (!existing) {
            byOwner.set(holder.owner, {
                owner: holder.owner,
                tokenAccounts: new Set(holder.tokenAccount ? [holder.tokenAccount] : []),
                amount: String(holder.amount || '0'),
                decimals: holder.decimals ?? ''
            });
            continue;
        }

        if (holder.tokenAccount) existing.tokenAccounts.add(holder.tokenAccount);
        existing.amount = addBigIntStrings(existing.amount, holder.amount);
        if (existing.decimals === '' && holder.decimals !== '') existing.decimals = holder.decimals;
    }

    return Array.from(byOwner.values()).map(holder => ({
        owner: holder.owner,
        tokenAccounts: Array.from(holder.tokenAccounts).join('|'),
        amount: holder.amount,
        decimals: holder.decimals
    }));
}

async function readTokensFromFile(inputFile, seen) {
    const stream = fs.createReadStream(inputFile);
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let headers = null;
    const tokens = [];

    for await (const line of rl) {
        if (!line.trim()) continue;

        if (!headers) {
            headers = parseCsvLine(line).map(header => header.trim());
            continue;
        }

        const fields = parseCsvLine(line);
        const record = {};
        headers.forEach((header, index) => {
            record[header] = fields[index] || '';
        });

        const mint = record.mint || record.address || record.tokenAddress || record.token || record.token_mint;
        if (!mint || seen.has(mint)) continue;

        seen.add(mint);
        tokens.push({
            ...record,
            mint,
            sourceFile: inputFile
        });

        if (TOKEN_LIMIT > 0 && seen.size >= TOKEN_LIMIT) break;
    }

    return tokens;
}

async function readTokens(inputFiles) {
    const files = Array.isArray(inputFiles) ? inputFiles : [inputFiles];
    const seen = new Set();
    const tokens = [];

    for (const inputFile of files) {
        if (!inputFile || !fs.existsSync(inputFile)) continue;
        const fileTokens = await readTokensFromFile(inputFile, seen);
        for (const token of fileTokens) {
            tokens.push(token);
        }
        if (TOKEN_LIMIT > 0 && tokens.length >= TOKEN_LIMIT) break;
    }

    return TOKEN_LIMIT > 0 ? tokens.slice(0, TOKEN_LIMIT) : tokens;
}

function readCompletedMints(summaryFile) {
    const completed = new Set();
    const stats = {
        processedTokens: 0,
        successfulTokens: 0,
        failedTokens: 0,
        totalHolderRows: 0
    };

    if (!fs.existsSync(summaryFile)) {
        return { completed, stats };
    }

    const lines = fs.readFileSync(summaryFile, 'utf8')
        .split(/\r?\n/)
        .filter(line => line.trim());

    for (const line of lines.slice(1)) {
        const fields = parseCsvLine(line);
        const mint = fields[0];
        const holderRows = Number(fields[4] || 0);
        const status = fields[7] || '';

        if (!mint || completed.has(mint)) continue;

        completed.add(mint);
        stats.processedTokens++;
        stats.totalHolderRows += Number.isFinite(holderRows) ? holderRows : 0;

        if (status === 'success') stats.successfulTokens++;
        if (status === 'failed') stats.failedTokens++;
    }

    return { completed, stats };
}

class CsvHolderExporter {
    constructor({ inputFiles }) {
        this.inputFiles = inputFiles && inputFiles.length ? inputFiles : listDefaultInputFiles();
        this.files = outputFiles();
        this.endpoints = config.rpcEndpoints.filter(endpoint => endpoint.url && !endpoint.url.includes('YOUR_KEY'));
        this.rateLimiters = new Map();
        this.completed = new Set();
        this.stats = {
            startedAt: new Date().toISOString(),
            inputFiles: this.inputFiles,
            holderCsv: this.files.holders,
            summaryCsv: this.files.summary,
            errorsCsv: this.files.errors,
            manifestJson: this.files.manifest,
            checkpointJson: this.files.checkpoint,
            totalTokens: 0,
            sourceUniqueTokens: 0,
            skippedCompletedTokens: 0,
            processedTokens: 0,
            successfulTokens: 0,
            failedTokens: 0,
            totalHolderRows: 0,
            currentStateOnly: true,
            note: 'RPC/DAS token account queries return current holders, not every historical wallet that ever held a token.'
        };
    }

    ensureOutputFiles() {
        fs.mkdirSync(config.outputDir, { recursive: true });

        if (!fs.existsSync(this.files.holders)) {
            fs.writeFileSync(this.files.holders, csvRow([
                'mint',
                'symbol',
                'name',
                'decimals',
                'owner',
                'token_accounts',
                'raw_balance_sum',
                'holder_row_key',
                'rpc_used',
                'source_file'
            ]), 'utf8');
        }

        if (!fs.existsSync(this.files.summary)) {
            fs.writeFileSync(this.files.summary, csvRow([
                'mint',
                'symbol',
                'name',
                'decimals',
                'holder_row_count',
                'token_account_count',
                'rpc_used',
                'status',
                'error',
                'source_file'
            ]), 'utf8');
        }

        if (!fs.existsSync(this.files.errors)) {
            fs.writeFileSync(this.files.errors, csvRow([
                'mint',
                'symbol',
                'name',
                'rpc_used',
                'error',
                'source_file'
            ]), 'utf8');
        }
    }

    writeCheckpoint(extra = {}) {
        fs.writeFileSync(this.files.checkpoint, JSON.stringify({
            ...this.stats,
            ...extra,
            updatedAt: new Date().toISOString()
        }, null, 2));
    }

    getEndpoint(index) {
        return this.endpoints[index % this.endpoints.length];
    }

    getRateLimiter(endpoint) {
        if (!this.rateLimiters.has(endpoint.url)) {
            const limit = endpoint.type === 'das' ? config.rateLimits.das : config.rateLimits.rpc;
            this.rateLimiters.set(endpoint.url, new RateLimiter(limit));
        }
        return this.rateLimiters.get(endpoint.url);
    }

    async rpc(endpoint, body, timeout = 30000) {
        await this.getRateLimiter(endpoint).wait();
        const response = await axios.post(endpoint.url, body, {
            timeout,
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data?.error) {
            throw new Error(`${response.data.error.message || 'RPC error'} (${response.data.error.code || 'unknown'})`);
        }

        return response.data;
    }

    async getSlot() {
        let lastError = null;

        for (const endpoint of this.endpoints) {
            try {
                const response = await this.rpc(endpoint, {
                    jsonrpc: '2.0',
                    id: 'slot-watermark',
                    method: 'getSlot',
                    params: [{ commitment: 'confirmed' }]
                }, 15000);
                return { slot: response.result, rpcName: endpoint.name };
            } catch (error) {
                lastError = new Error(`[${endpoint.name}] ${errorMessage(error)}`);
            }
        }

        throw lastError || new Error('No usable RPC endpoints configured');
    }

    async fetchDASPage(endpoint, mint, page) {
        const response = await this.rpc(endpoint, {
            jsonrpc: '2.0',
            id: `holders-${mint.slice(0, 8)}-${page}`,
            method: 'getTokenAccounts',
            params: {
                page,
                limit: PAGE_SIZE,
                mint,
                displayOptions: { showZeroBalance: false }
            }
        });

        const accounts = response.result?.token_accounts || [];
        return accounts.map(account => ({
            owner: account.owner,
            tokenAccount: account.address,
            amount: account.amount ?? account.balance ?? '',
            decimals: account.decimals ?? ''
        }));
    }

    async fetchRpcAccounts(endpoint, mint) {
        const response = await this.rpc(endpoint, {
            jsonrpc: '2.0',
            id: `holders-${mint.slice(0, 8)}-gpa`,
            method: 'getProgramAccounts',
            params: [
                TOKEN_PROGRAM_ID,
                {
                    encoding: 'jsonParsed',
                    withContext: true,
                    filters: [
                        { dataSize: 165 },
                        { memcmp: { offset: 0, bytes: mint } }
                    ]
                }
            ]
        }, 60000);

        const accounts = response.result?.value || response.result || [];
        return accounts
            .map(account => {
                const info = account.account?.data?.parsed?.info;
                if (!info) return null;
                const amount = info.tokenAmount?.amount || '0';
                if (amount === '0') return null;
                return {
                    owner: info.owner,
                    tokenAccount: account.pubkey,
                    amount,
                    decimals: info.tokenAmount?.decimals ?? ''
                };
            })
            .filter(Boolean);
    }

    async fetchTokenAccounts(token, endpoint) {
        const mint = token.mint;
        const holders = [];
        let page = 1;

        try {
            while (true) {
                const accounts = await this.fetchDASPage(endpoint, mint, page);
                holders.push(...accounts);

                if (accounts.length < PAGE_SIZE) break;
                if (MAX_HOLDERS_PER_TOKEN > 0 && holders.length >= MAX_HOLDERS_PER_TOKEN) break;
                page++;
            }

            return MAX_HOLDERS_PER_TOKEN > 0 ? holders.slice(0, MAX_HOLDERS_PER_TOKEN) : holders;
        } catch (error) {
            if (endpoint.type === 'das') throw error;
        }

        const accounts = await this.fetchRpcAccounts(endpoint, mint);
        return MAX_HOLDERS_PER_TOKEN > 0 ? accounts.slice(0, MAX_HOLDERS_PER_TOKEN) : accounts;
    }

    async processToken(token, index) {
        const endpoint = this.getEndpoint(index);
        const mint = token.mint;

        try {
            const tokenAccounts = await this.fetchTokenAccounts(token, endpoint);
            const holders = aggregateHoldersByOwner(tokenAccounts);
            const holderRows = holders.map(holder => csvRow([
                mint,
                token.symbol,
                token.name,
                token.decimals || holder.decimals,
                holder.owner,
                holder.tokenAccounts,
                holder.amount,
                `${mint}:${holder.owner}`,
                endpoint.name,
                token.sourceFile
            ])).join('');

            if (holderRows) {
                fs.appendFileSync(this.files.holders, holderRows, 'utf8');
            }

            fs.appendFileSync(this.files.summary, csvRow([
                mint,
                token.symbol,
                token.name,
                token.decimals,
                holders.length,
                tokenAccounts.length,
                endpoint.name,
                'success',
                '',
                token.sourceFile
            ]), 'utf8');

            this.completed.add(mint);
            this.stats.successfulTokens++;
            this.stats.totalHolderRows += holders.length;
            return { success: true };
        } catch (error) {
            const message = errorMessage(error);
            fs.appendFileSync(this.files.errors, csvRow([
                mint,
                token.symbol,
                token.name,
                endpoint.name,
                message,
                token.sourceFile
            ]), 'utf8');
            fs.appendFileSync(this.files.summary, csvRow([
                mint,
                token.symbol,
                token.name,
                token.decimals,
                0,
                0,
                endpoint.name,
                'failed',
                message,
                token.sourceFile
            ]), 'utf8');

            this.completed.add(mint);
            this.stats.failedTokens++;
            return { success: false };
        } finally {
            this.stats.processedTokens++;
            if (this.stats.processedTokens % 25 === 0) {
                this.writeCheckpoint({ lastProcessedMint: mint });
            }
            if (this.stats.processedTokens % 100 === 0 || this.stats.processedTokens === this.stats.totalTokens) {
                console.log(
                    `Processed ${this.stats.processedTokens}/${this.stats.totalTokens} remaining tokens; ` +
                    `${this.stats.totalHolderRows} holder rows written`
                );
            }
        }
    }

    async run() {
        if (this.endpoints.length === 0) {
            throw new Error('No usable RPC endpoints configured. Add RPC URLs to .env.');
        }

        if (this.inputFiles.length === 0) {
            throw new Error('No source token CSV files found. Put tokens.csv and the pump.fun CSV in data/, or pass --input file1 --input file2.');
        }

        this.ensureOutputFiles();

        const resume = readCompletedMints(this.files.summary);
        this.completed = resume.completed;
        this.stats.successfulTokens = resume.stats.successfulTokens;
        this.stats.failedTokens = resume.stats.failedTokens;
        this.stats.totalHolderRows = resume.stats.totalHolderRows;

        const tokens = await readTokens(this.inputFiles);
        const remaining = tokens.filter(token => !this.completed.has(token.mint));
        this.stats.sourceUniqueTokens = tokens.length;
        this.stats.skippedCompletedTokens = tokens.length - remaining.length;
        this.stats.totalTokens = remaining.length;
        this.stats.pageSize = PAGE_SIZE;
        this.stats.maxHoldersPerToken = MAX_HOLDERS_PER_TOKEN || null;
        this.stats.concurrency = CONCURRENCY;

        console.log(`Source CSV files: ${this.inputFiles.join(', ')}`);
        console.log(`Unique token mints: ${tokens.length}`);
        console.log(`Already completed mints: ${this.stats.skippedCompletedTokens}`);
        console.log(`Remaining mints this run: ${remaining.length}`);
        console.log(`Stable holder CSV: ${this.files.holders}`);

        if (remaining.length === 0) {
            this.stats.completedAt = new Date().toISOString();
            this.writeCheckpoint();
            fs.writeFileSync(this.files.manifest, JSON.stringify(this.stats, null, 2));
            console.log('No remaining mints to process. Stable files are already up to date.');
            return;
        }

        const startSlot = await this.getSlot();
        this.stats.startSlot = startSlot.slot;
        this.stats.startSlotRpc = startSlot.rpcName;
        this.writeCheckpoint();

        let nextIndex = 0;
        const workers = Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
            while (nextIndex < remaining.length) {
                const index = nextIndex++;
                await this.processToken(remaining[index], index);
            }
        });

        await Promise.all(workers);

        const endSlot = await this.getSlot();
        this.stats.completedAt = new Date().toISOString();
        this.stats.latestFetchedSlot = endSlot.slot;
        this.stats.latestFetchedSlotRpc = endSlot.rpcName;
        this.writeCheckpoint({ latestFetchedSlot: endSlot.slot });
        fs.writeFileSync(this.files.manifest, JSON.stringify(this.stats, null, 2));

        console.log(`Holder CSV: ${this.files.holders}`);
        console.log(`Summary CSV: ${this.files.summary}`);
        console.log(`Errors CSV: ${this.files.errors}`);
        console.log(`Manifest: ${this.files.manifest}`);
        console.log(`Latest fetched slot watermark: ${endSlot.slot}`);
    }
}

function parseInputFiles(argv) {
    const files = [];

    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--input' && argv[i + 1]) {
            files.push(argv[i + 1]);
            i++;
        }
    }

    return files.length ? files : listDefaultInputFiles();
}

async function main() {
    const inputFiles = parseInputFiles(process.argv.slice(2));
    const exporter = new CsvHolderExporter({ inputFiles });
    await exporter.run();
}

if (require.main === module) {
    main().catch(error => {
        console.error(`Holder CSV export failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    CsvHolderExporter,
    aggregateHoldersByOwner,
    listDefaultInputFiles,
    outputFiles,
    parseInputFiles,
    readCompletedMints,
    readTokens
};
