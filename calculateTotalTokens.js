const fs = require('fs');
const path = require('path');

function readJsonFile(filePath) {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
}

function getProposalFiles() {
    const files = fs.readdirSync('.');
    return files.filter(file => file.startsWith('proposal') && file.endsWith('.json'));
}

function calculateTotalTokens() {
    const proposalFiles = getProposalFiles();
    const accountTotals = new Map();

    proposalFiles.forEach(file => {
        const data = readJsonFile(file);
        console.log(`Processing ${file}...`);

        data.voters.forEach(voter => {
            if (voter.is_eligible) {
                const tokenCount = Number(voter.token_count);
                const currentTotal = accountTotals.get(voter.account) || 0;
                accountTotals.set(voter.account, currentTotal + tokenCount);
            }
        });
    });

    const sortedAccounts = Array.from(accountTotals.entries())
        .sort((a, b) => b[1] - a[1]);

    const output = sortedAccounts
        .map(([account, tokens]) => `${account}: ${tokens.toLocaleString()}`)
        .join('\n');

    fs.writeFileSync('total_tokens.txt', output);
    console.log('Results written to total_tokens.txt');
}

calculateTotalTokens(); 