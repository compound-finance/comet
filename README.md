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
