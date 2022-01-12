# Compound Comet

## Getting started

1. Clone the repo
2. Run `yarn install`

## Env variables

The following env variables are used in the repo. One way to set up these env
variables is to create a `.env` in the root directory of this repo.

Required env variables:

```
ETHERSCAN_KEY=<key>
INFURA_KEY=<key>
```

Optional env variables:

```
SNOWTRACE_KEY=<key>
COINMARKETCAP_API_KEY=<key>
REPORT_GAS=true
ETH_PK=<eth-key>             # takes precedence over MNEMONIC
MNEMONIC=<mnemonic>
```

## Git hooks

The repo's Git hooks are defined the `.githooks/` directory.

You can enable them by running:

```
# requires git version 2.9 or greater
git config core.hooksPath .githooks
```

You can skip pre-commit checks with the `-n` flag:

```
git commit -n -m "commit without running pre-commit hook"
```

## Multi-chain support

Currently, Avalanche mainnet and testnet (fuji) are supported. This means that deployment scripts, scenarios, and spider all work for Avalanche.

To use this project with other chains, the block explorer API key for your target chain must be set in .env (e.g. `SNOWTRACE_KEY` for Avalanche).

An example deployment command looks like:

`yarn deploy --network fuji`

## Usage

Look at the scripts section inside `package.json` to find all commands.

### Build contracts

Compiles contracts.

`yarn build`

### Lint contracts

Contract linting is done via [Solhint](https://github.com/protofire/solhint).

```
yarn lint-contracts
yarn lint-contracts:fix // will attempt to automatically fix errors
```

Solhint configuration is saved in `.solhint.json`.

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

### Deploy contracts

Deploys contracts to a specified chain using a deployment script.

`yarn deploy --network mainnet`

### Run spider task

The spider script programmatically fetches all protocol-related contracts from mainnet.
This is just a prototype and it currently pulls relevant contracts for V2.

> Note: Make sure $ETHERSCAN_KEY is set as an env variable.

`npx hardhat spider --network mainnet`

#### Delete artifacts

You can delete all spider artifacts using the `--clean` flag:

`npx hardhat spider --clean`

#### Spider configs

The spider script uses configuration from two files to start its crawl:

- `roots.json`
- `relations.json`

Both these contracts are committed to the repo under `deployments/<chain>/<file>.json`. The `roots.json` config contains the address of the root contract for spider to start crawling from. The `relations.json` config defines all the different relationships and rules that spider will follow when crawling. The following section will go over in detail the set of rules defined in `relations.json`.

#### Defining relations

Currently, these are the 3 types of rules in `relations.json` that can be defined for a contract:

1. **Alias** - A rule to derive the key that is assigned to this contract in `pointers.json`. If this rule is not provided, the contract name will be used as the alias instead. This rule has two special characters: `@` and `+`. `@` followed by a function name is used to read a value from that contract's function. `+` is used as a delimiter. Example: `@symbol+Delegator` will equate to `cDaiDelegator` for `cDai`'s delegator contract.
2. **Relations** - The names of the contract's functions to call to fetch dependent contracts.
3. **Implementation** - The name of the contract's function to call to grab its implementation address. This should only be defined for proxy contracts.

### Scenarios

Scenarios are high-level property and ad-hoc tests for the Comet protocol. To run and check scenarios:

`npx hardhat scenario`

For more information, see [SCENARIO.md](./SCENARIO.md).
