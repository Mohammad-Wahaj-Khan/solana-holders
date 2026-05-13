// src/index.js
// Default CLI entry point. Merges token source CSVs and writes one stable resumable holder CSV.

const { CsvHolderExporter, parseInputFiles } = require('./exportHoldersCsv');

async function main() {
    const inputFiles = parseInputFiles(process.argv.slice(2));

    console.log('\nSolana Token Holders CSV Exporter');
    console.log('='.repeat(60));
    console.log(`Token sources: ${inputFiles.length ? inputFiles.join(', ') : '(none found)'}`);
    console.log('Output is stable/resumable: data/all_token_holders.csv');
    console.log('Note: RPC token-account queries return current holders, not historical all-time holders.');

    const exporter = new CsvHolderExporter({ inputFiles });
    await exporter.run();
}

main().catch(error => {
    console.error(`Processing failed: ${error.message || error}`);
    process.exitCode = 1;
});
