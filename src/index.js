// src/index.js
// Default CLI entry point. Reads token mints from data/tokens.csv and streams holder rows to CSV.

const path = require('path');
const config = require('../config/config');
const { CsvHolderExporter, findLatestSummaryFile } = require('./exportHoldersCsv');

async function main() {
    const inputFlagIndex = process.argv.indexOf('--input');
    const inputFile = inputFlagIndex >= 0 && process.argv[inputFlagIndex + 1]
        ? process.argv[inputFlagIndex + 1]
        : config.tokenCsvPath || path.join(config.outputDir, 'tokens.csv');
    const startIndexFlagIndex = process.argv.indexOf('--start-index');
    const startIndex = startIndexFlagIndex >= 0 && process.argv[startIndexFlagIndex + 1]
        ? Number(process.argv[startIndexFlagIndex + 1])
        : Number(process.env.START_INDEX || 0);
    const resumeFlagIndex = process.argv.indexOf('--resume');
    let resumeSummaryFile = null;

    if (resumeFlagIndex >= 0) {
        const resumeValue = process.argv[resumeFlagIndex + 1];
        resumeSummaryFile = resumeValue && resumeValue !== 'latest'
            ? resumeValue
            : findLatestSummaryFile();

        if (!resumeSummaryFile) {
            throw new Error('No previous token_holders_summary_*.csv file found to resume');
        }
    }

    console.log('\nSolana Token Holders CSV Exporter');
    console.log('='.repeat(60));
    console.log(`Token source: ${inputFile}`);
    if (resumeSummaryFile) {
        console.log(`Resume summary: ${resumeSummaryFile}`);
    } else if (startIndex > 0) {
        console.log(`Start index: ${startIndex}`);
    }
    console.log('Note: RPC token-account queries return current holders, not historical all-time holders.');

    const exporter = new CsvHolderExporter({ inputFile, resumeSummaryFile, startIndex });
    await exporter.run();
}

main().catch(error => {
    console.error(`Processing failed: ${error.message || error}`);
    process.exitCode = 1;
});
