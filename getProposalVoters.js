const dsteem = require('dsteem');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const client = new dsteem.Client('https://api.steemit.com');

let globalProperties;
const proposalId = 90;
const totalAirdrop = 160000000; // 160 million
const months = 8;
const airdropPerMonth = totalAirdrop / months;  // 20 million per month

function vestingSharesToSP(vestingShares) {
    const availableVESTS = parseFloat(vestingShares.split(' ')[0]);

    const totalVestingFundSteem = parseFloat(globalProperties.total_vesting_fund_steem.split(' ')[0]);
    const totalVestingShares = parseFloat(globalProperties.total_vesting_shares.split(' ')[0]);

    return (totalVestingFundSteem * availableVESTS) / totalVestingShares;
}

function calculateAirdropShare(effectiveSP, totalSP) {
    const share = (parseFloat(effectiveSP) / totalSP) * airdropPerMonth;
    return share.toFixed(0);
}

async function getVoters(proposalId) {
    try {
        const response = await client.database.call('list_proposal_votes', [[proposalId, ""], 1000, "by_proposal_voter", "ascending", "all"]);

        const voters = response
            .filter(vote => vote.proposal.id === proposalId)
            .map(vote => vote.voter);

        console.log(`Found ${voters.length} direct votes for proposal ${proposalId}`);
        return voters;
    } catch (error) {
        console.error('Error fetching voters:', error);
    }
}

async function getProxiedAccounts(voters) {
    try {
        console.log(`Fetching proxied accounts for ${voters.length} voters`);

        const allProxiedAccounts = new Set();
        const proxiedSPMap = new Map();
        const proxyVoterMap = new Map();

        for (const voter of voters) {
            console.log(`Checking accounts that proxy to ${voter}`);
            try {
                const response = await fetch(`https://sds.steemworld.org/witnesses_api/getWitnessProxyChainBackwards/${voter}`);
                const data = await response.json();
                if (data.code === 0 && data.result && data.result.proxied_by) {
                    // Only process direct proxies to voters
                    data.result.proxied_by.forEach(item => {
                        if (item.vests > 0) {
                            const sp = vestingSharesToSP(item.vests + ' VESTS');
                            allProxiedAccounts.add(item.account);
                            proxiedSPMap.set(item.account, sp);
                            proxyVoterMap.set(item.account, voter);
                        }
                    });
                    await new Promise(resolve => setTimeout(resolve, 500));
                    console.log(`Found ${data.result.proxied_by.length} direct proxies to ${voter}`);
                }
            } catch (error) {
                console.error(`Error fetching proxied accounts for ${voter}:`, error);
                continue;
            }
        }

        console.log(`Found ${allProxiedAccounts.size} proxied accounts with non-zero vests`);
        return {
            accounts: Array.from(allProxiedAccounts),
            proxiedSP: proxiedSPMap,
            proxyVoterMap: proxyVoterMap
        };
    } catch (error) {
        console.error('Error fetching proxied accounts:', error);
        return { accounts: [], proxiedSP: new Map(), proxyVoterMap: new Map() };
    }
}

async function getAccountsInfo(accounts) {
    try {
        const accountsArray = Array.isArray(accounts) ? accounts : Array.from(accounts);
        const batchSize = 500;
        const results = [];

        for (let i = 0; i < accountsArray.length; i += batchSize) {
            const batch = accountsArray.slice(i, i + batchSize);
            console.log(`Fetching account info for batch ${i / batchSize + 1} (${batch.length} accounts)`);

            try {
                const accountsInfo = await client.database.getAccounts(batch);

                accountsInfo.forEach(accountData => {
                    if (accountData) {
                        const sp = vestingSharesToSP(accountData.vesting_shares);
                        results.push({
                            account: accountData.name,
                            sp: sp.toFixed(0),
                            total_sp: sp.toFixed(0),
                            proxy_to: accountData.proxy || null
                        });
                    }
                });

                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                console.error(`Error fetching batch ${i / batchSize + 1}:`, error);
                continue;
            }
        }

        return results;
    } catch (error) {
        console.error('Error in getAccountsInfo:', error);
        return [];
    }
}

async function getProposalVotersAndSP(proposalId) {
    try {
        console.log(`\nFetching voters and SP information for proposal ${proposalId}...\n`);

        const directVoters = await getVoters(proposalId);
        console.log(`Found ${directVoters.length} direct voters`);

        const directVotersInfo = await getAccountsInfo(directVoters);

        const votersWithProxy = new Set();
        directVotersInfo.forEach(account => {
            if (account.proxy_to) {
                votersWithProxy.add(account.proxy_to);
            }
        });

        console.log(`Found ${votersWithProxy.size} proxies set by direct voters`);

        const { accounts: proxiedAccounts, proxiedSP, proxyVoterMap } = await getProxiedAccounts(directVoters);

        // Only include direct voters and accounts that proxy directly to voters
        const allAccounts = new Set([...directVoters, ...proxiedAccounts]);
        console.log(`Total accounts (voters + direct proxies): ${allAccounts.size}`);

        const results = {
            snapshotTimestamp: new Date().toISOString(),
            proposalId: proposalId,
            totalVoters: directVoters.length,
            totalProxiedAccounts: proxiedAccounts.length,
            totalAirdrop: totalAirdrop,
            airdropPerMonth: airdropPerMonth,
            proposaltotalSP: 0,
            airdropTotalTokenCount: 0,
            voters: []
        };

        const accountsInfo = await getAccountsInfo(Array.from(allAccounts));

        // Calculate total SP (only counting eligible accounts)
        let totalSP = accountsInfo.reduce((sum, account) => {
            const baseSP = parseFloat(account.total_sp);
            // For direct voters, check if they have a proxy
            if (directVoters.includes(account.account)) {
                const voterInfo = directVotersInfo.find(v => v.account === account.account);
                // If they have a proxy, check if the proxy is also voting
                if (voterInfo && voterInfo.proxy_to) {
                    if (directVoters.includes(voterInfo.proxy_to)) {
                        return sum + baseSP;
                    }
                    return sum;
                }
                return sum + baseSP;
            }
            const proxyVoter = proxyVoterMap.get(account.account);
            if (proxyVoter && directVoters.includes(proxyVoter)) {
                return sum + (proxiedSP.get(account.account) || 0);
            }
            return sum;
        }, 0);

        results.proposaltotalSP = totalSP;

        results.voters = accountsInfo
            .map(account => {
                const baseSP = parseFloat(account.total_sp);
                if (directVoters.includes(account.account)) {
                    const voterInfo = directVotersInfo.find(v => v.account === account.account);
                    // If they have a proxy, check if the proxy is also voting
                    if (voterInfo && voterInfo.proxy_to) {
                        const isEligible = directVoters.includes(voterInfo.proxy_to);
                        const spShare = isEligible ? (baseSP / totalSP) * 100 : 0;
                        return {
                            ...account,
                            sp: baseSP.toFixed(0),
                            proxied_sp: "0",
                            total_sp: isEligible ? baseSP.toFixed(0) : "0",
                            sp_share_percent: spShare.toFixed(2),
                            token_count: isEligible ? calculateAirdropShare(baseSP, totalSP) : "0",
                            is_eligible: isEligible,
                            proxy_to: voterInfo.proxy_to
                        };
                    }
                    // If no proxy, they're eligible with their base SP
                    const spShare = (baseSP / totalSP) * 100;
                    return {
                        ...account,
                        sp: baseSP.toFixed(0),
                        proxied_sp: "0",
                        total_sp: baseSP.toFixed(0),
                        sp_share_percent: spShare.toFixed(2),
                        token_count: calculateAirdropShare(baseSP, totalSP),
                        is_eligible: true,
                        proxy_to: null
                    };
                }
                const proxyVoter = proxyVoterMap.get(account.account);
                const proxiedSPAmount = proxiedSP.get(account.account) || 0;
                const isEligible = proxyVoter && directVoters.includes(proxyVoter);
                const spShare = isEligible ? (proxiedSPAmount / totalSP) * 100 : 0;
                return {
                    ...account,
                    sp: "0",
                    proxied_sp: proxiedSPAmount.toFixed(0),
                    total_sp: isEligible ? proxiedSPAmount.toFixed(0) : "0",
                    sp_share_percent: spShare.toFixed(2),
                    token_count: isEligible ? calculateAirdropShare(proxiedSPAmount, totalSP) : "0",
                    is_eligible: isEligible,
                    proxy_to: proxyVoter
                };
            })
            .sort((a, b) => parseFloat(b.total_sp) - parseFloat(a.total_sp));

        console.log('\nTotal SP Information:');
        console.log(`Total SP among all accounts: ${results.totalSP}`);
        console.log(`Average SP per account: ${(totalSP / allAccounts.size).toFixed(0)}`);
        console.log(`Total airdrop per month: ${airdropPerMonth}`);
        console.log(`Airdrop per SP: ${(airdropPerMonth / totalSP).toFixed(6)}`);

        const totalTokenCount = results.voters.reduce((sum, voter) => sum + parseFloat(voter.token_count || 0), 0);
        console.log(`Total token count: ${totalTokenCount}`);
        results.airdropTotalTokenCount = totalTokenCount;

        console.log('\nTop 10 Accounts by SP:');
        results.voters.slice(0, 10).forEach((voter, index) => {
            console.log(`${index + 1}. ${voter.account}: ${voter.total_sp} SP (${voter.sp_share_percent}%) - ${voter.token_count} tokens`);
        });

        const outputPath = path.join(__dirname, `proposal_${proposalId}_months_${new Date().getMonth() + 1}_voters.json`);
        fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
        console.log(`\nResults saved to: ${outputPath}`);

    } catch (error) {
        console.error('Error:', error);
    }
}

client.database.call('get_dynamic_global_properties', []).then(result => {
    globalProperties = result;
    getProposalVotersAndSP(proposalId);
});