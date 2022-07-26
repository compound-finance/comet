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

## Comet protocol contracts

**[Comet.sol](https://github.com/compound-finance/comet/blob/main/contracts/Comet.sol)** - Contract that inherits `CometMainInterface.sol` and is the implementation for most of Comet's core functionalities. A small set of functions that do not fit within this contract are implemented in `CometExt.sol` instead, which Comet `DELEGATECALL`s to for unrecognized function signatures.

**[CometExt.sol](https://github.com/compound-finance/comet/blob/main/contracts/CometExt.sol)** - Contract that inherits `CometExtInterface.sol` and is the implementation for extra functions that do not fit within `Comet.sol`, such as `approve`.

**[CometInterface.sol](https://github.com/compound-finance/comet/blob/main/contracts/CometInterface.sol)** - Abstract contract that inherits `CometMainInterface.sol` and `CometExtInterface.sol`. This interface contains all the functions and events for `Comet.sol` and `CometExt.sol` and is ERC-20 compatible.

**[CometMainInterface.sol](https://github.com/compound-finance/comet/blob/main/contracts/CometMainInterface.sol)** - Abstract contract that inherits `CometCore.sol` and contains all the functions and events for `Comet.sol`.

**[CometExtInterface.sol](https://github.com/compound-finance/comet/blob/main/contracts/CometExtInterface.sol)** - Abstract contract that inherits `CometCore.sol` and contains all the functions and events for `CometExt.sol`.

**[CometCore.sol](https://github.com/compound-finance/comet/blob/main/contracts/CometCore.sol)** - Abstract contract that inherits `CometStorage.sol`, `CometConfiguration.sol`, and `CometMath.sol`. This contracts contains functions and constants that are shared between `Comet.sol` and `CometExt.sol`.

**[CometStorage.sol](https://github.com/compound-finance/comet/blob/main/contracts/CometStorage.sol)** - Contract that defines the storage variables used for the Comet protocol.

**[CometConfiguration.sol](https://github.com/compound-finance/comet/blob/main/contracts/CometConfiguration.sol)** - Contract that defines the configuration structs passed into the constructors for `Comet.sol` and `CometExt.sol`.

**[CometMath.sol](https://github.com/compound-finance/comet/blob/main/contracts/CometMath.sol)** - Contract that defines math functions that are used throughout the Comet codebase.

**[CometFactory.sol](https://github.com/compound-finance/comet/blob/main/contracts/CometFactory.sol)** - Contract that inherits `CometConfiguration.sol` and is used to deploy new versions of `Comet.sol`. This contract will mainly be called by the Configurator during the governance upgrade process.

## Configurator contracts

**[Configurator.sol](https://github.com/compound-finance/comet/blob/main/contracts/Configurator.sol)** - Contract that inherits `ConfiguratorStorage.sol`. This contract manages Comet's configurations and deploys new implementations of Comet.

**[ConfiguratorStorage.sol](https://github.com/compound-finance/comet/blob/main/contracts/ConfiguratorStorage.sol)** - Contract that inherits `CometConfiguration.sol` and defines the storage variables for `Configurator.sol`.

## Supplementary contracts

**[Bulker.sol](https://github.com/compound-finance/comet/blob/main/contracts/Bulker.sol)** - Contract that allows multiple Comet functions to be called in a single transaction.

**[CometRewards.sol](https://github.com/compound-finance/comet/blob/main/contracts/CometRewards.sol)** - Contract that allows Comet users to claim rewards based on their protocol participation.

## Vendor contracts

Third-party contracts (e.g. OZ proxies) live under `contracts/vendor`.

There are currently two Comet-related contracts that extend directly from the vendor contracts. The contracts are:

**[ConfiguratorProxy.sol](https://github.com/compound-finance/comet/blob/main/contracts/ConfiguratorProxy.sol)** - This contract inherits OZ's `TransparentUpgradeableProxy.sol`. We override the `_beforeFallback` function so that the proxy's admin can directly call the implementation. We only need this feature for the Configurator's proxy.

**[CometProxyAdmin.sol](https://github.com/compound-finance/comet/blob/main/contracts/CometProxyAdmin.sol)** - This contract inherits OZ's `ProxyAdmin.sol`. We created a new function called `deployAndUpgradeTo`, which calls `Configurator.deploy(0xCometProxy)` and upgrades Comet proxy's implementation to this newly deployed Comet contract. This function is needed so we can pass the address of the new Comet to the `Proxy.upgrade()` call in one transaction.

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

### Migrations

XXX explain/get to
 deploying a new root contract?
  deployments/${network}/${instance}/deploy/XXX
 otherwise
  deployments/${network}/${instance}/change/XXX

Open PR, run `migration-script` workflow through CI
 will commit `deployments/` diffs to branch
  wait for governance/execution
   merge PR with any new/modified roots

New deployment?
 copy `deploy/` scripts from existing instance
  ignore proposals
   run, same as above

### Deploying to testnets

#### Kovan

XXX simplify to above

1. run `1644388553_deploy_kovan` migration, `prepare` step
2. update `deployments/kovan/roots.json` with the new roots from step 1
3. run `1649108513_upgrade_timelock_and_set_up_governor` migration, `prepare` step
4. run `1649108513_upgrade_timelock_and_set_up_governor` migration, `enact` step
5. find the proposal ID step from 4; manually execute the proposal via the newly-deployed Governor
6. run `1651257129_bulker_and_rewards` migration, `prepare` step
7. update `deployments/kovan/roots.json` with the rewards and bulker roots from step 6
8. run `1653357106_mint_to_fauceteer` migration, `prepare` step
9. run `1653512186_seed_rewards_with_comp`, `prepare` step
10. run `1653512186_seed_rewards_with_comp`, `enact` step
11. execute the proposal from step 10

#### Fuji

1. run `1644432723_deploy_fuji`, `prepare` step
2. update `deployments/fuji/roots.json` with new roots from step 1
3. run `1649117302_upgrade_timelock_and_set_up_governor`, `prepare` step
4. run `1649117302_upgrade_timelock_and_set_up_governor`, `enact` step
5. find the proposal ID step from 4; manually execute the proposal via the newly-deployed Governor
6. run `1651257139_rewards`, `prepare` step
7. update `deployments/fuji/roots.json` with new rewards root from step 6
8. run `1653431603_mint_to_fauceteer`, `prepare` step

#### Update Webb3 to use new roots

1. in the Webb3 repo, run `rm -rf deployments` to clear out the previous deploy artifacts
2. in `scripts/crawl.sh`, update the `DEPLOYMENTS` variable to point to the
   artifact with your latest deployed roots (will be the artifact generated by the `Run Spider` Action)
3. `npm run build`

#### Other considerations

- make sure that the deploying address has at least 2 units of the chain's
  native asset (i.e. 2 ETH for Kovan, 2 AVAX for Fuji)

### Liquidation Bot

This repo includes a contract (Liquidator.sol) that will absorb an underwater
position, purchase the absorbed collateral, and then attempt to sell it on
Uniswap for a profit.

To run the bot, you'll need the address of a deployed version of the Liquidator
contract (or you can deploy a new instance of it yourself):

`LIQUIDATOR_ADDRESS="0xABC..." yarn liquidation-bot`

Initiating transactions this way via the public mempool will
[almost certainly get frontrun](https://youtu.be/UZ-NNd6yjFM), but you might be
able to use [flashbots](https://docs.flashbots.net/) to mask your transactions
from frontrunners.