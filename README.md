# Compound Comet

## Getting started

1. Clone the repo
2. Run `yarn install`

## Usage

Look at the scripts section inside `package.json` to find all commands.

### Build contracts

Compiles contracts.

`yarn build`

### Run tests

Runs all tests in the `test` directory.

`yarn test`

### Run tests with coverage tool

Runs all tests while also evaluating code coverage.

`yarn test:coverage`

The coverage report will be saved in the `coverage` directory.

### Run tests with gas profiler

Set up the following env variables:

 - `REPORT_GAS=true`
 - `COINMARKETCAP_API_KEY=your_coinmarket_api_key`
   optional, only if you want to see cost in USD

### Run spider script

The spider script programmatically fetches all protocol-related contracts from mainnet. 
This is just a prototype and it currently pulls relevant contracts for V2.

> Note: Make sure $ETHERSCAN_KEY is set in your `.env`.

`npx hardhat run --network mainnet scripts/spider.ts`
