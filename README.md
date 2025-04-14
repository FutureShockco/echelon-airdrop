# Steem Proposal Voters

This script check for voters and their proxies for a specific Steem proposal, calculating SP (Steem Power) distribution and airdrop token allocation.

## Purpose

The script:
1. Identifies direct voters for a specific proposal
2. Finds accounts that proxy their voting power to these voters
3. Calculates SP distribution and token allocation based on voting power
4. Generates a JSON report of all voters

## Requirements

- Node.js
- npm

## Installation

1. Clone this repository
2. Install dependencies:
```bash
npm install
```

## Usage

Run the script:
```bash
npm start
```

## Notes

- Only accounts that directly voted for the proposal or proxy directly to voters are included
- SP calculations consider both direct voting power and proxied voting power
- Token distribution is proportional to the effective SP of each account 