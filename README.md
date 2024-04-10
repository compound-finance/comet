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

`yarn hardhat deploy --network fuji --deployment usdc`

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

### Run forge tests

Experimental support for `foundry` has been added, so assuming `forge` is installed:

```
forge test
```

See the [GitHub workflow](.github/workflows/run-forge-tests.yaml) for an example.


### Deploy contracts

Deploys contracts to a specified chain using a deployment script.

`yarn hardhat deploy --network mainnet --deployment usdc`

### Spider

Spider is a tool for programmatically fetching all protocol-related contracts from a desired network. Contracts are pulled in starting from the root set of contracts defined in `roots.json`. Then, it discovers and pulls in the web of related contracts (relations defined in `relations.json`), recursively iterating over new contracts until there are no more contracts left to discover. With spider, we can generate the comprehensive list of relevant contracts for each deployment directly from the blockchain without having to manually maintain all the addresses.

Once run locally, the spider task will generate a list of all the relevant contracts for a specific deployment in a file called `aliases.json`.

> Note: Spider relies on the Etherscan API to pull in contract-related info such as ABIs.

#### Run spider task

> Note: Make sure $ETHERSCAN_KEY is set as an env variable.

`npx hardhat spider --network mainnet --deployment usdc`

#### Delete spider artifacts

You can delete all spider artifacts using the `--clean` flag:

`npx hardhat spider --clean`

#### Spider configs

The spider script uses configuration from two files to start its crawl:

- `roots.json`
- `relations.json`

Both these contracts are committed to the repo under `deployments/<network>/<deployment>/<file>.json`. The `roots.json` config contains the address of the root contract for spider to start crawling from. The `relations.json` config defines all the different relationships and rules that spider will follow when crawling. The following section will go over in detail the set of rules defined in `relations.json`.

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

Migrations are used to make proposals to governance, for changes to the live protocol.
A migration script has two parts: `prepare` and `enact`.
The prepare step can perform necessary preparation of artifacts for the enact step, which is where the proposal gets made.

Migrations integrate with scenarios, so that changes are automatically tested against the entire scenario suite, with and without the proposal.
In fact, all combinations of open migrations are checked against the protocol, to ensure safety against any execution order by governance.
The same script that is used for testing can then be executed for real through the GitHub UI.

Once a proposal that's been made through a pull request has been executed by governance, the pull request should be merged into the `main` branch.
The PR should include any necessary tests, which will remain in the repository.
The migration script itself can be deleted in a separate commit, after the PR has been merged and recorded on the `main` branch, for good hygiene.
It's important to remove migrations once they've been executed, to avoid exploding the cost of running scenarios beyond what's necessary for testing.

For more information, seee [MIGRATIONS.md](./MIGRATIONS.md).

### Deploying to testnets

Each deployment of Comet should have an associated directory inside of `deployments` in the repository.
Deployments are stored per network, for instance `deployments/mainnet/usdc/`.

To start a new deployment, create the directory with a `deploy.ts` script and a `configuration.json` file (both probably copied initially from another deployment).
When copying files from other directories, `migrations` may safely be ignored, as they are meant only for migrating the state of an existing deployment, not starting fresh deployments.
New deployments and changes to them are also hypothetically tested with scenarios, like migrations are.
These simulations are extremely useful for testing deployments before actually creating them.

#### Deploy Workflow

1. Create the deployment script and configuration file, and test locally
2. Open a PR containing the new deployment directory files
3. Trigger the `deploy-market` workflow action through the GitHub UI
4. Inspect the new `roots.json` which the workflow automatically commited to your PR
5. Start using the new protocol deployment and/or create further migrations to modify it

##### Deploy Script Gotchas and Tips

- If the deploy script is for a new market on a chain with an existing market, make sure to call 'setFactory(address,address)' in the initialization migration script.
(TODO: Scenarios will fail prior to running the migration script because the factory will not be set during deployment, will need to figure out a better way)

##### Verifying Deployments

Source code verification is a relatively important part of deployments currently.
The 'spider' tool we use to crawl relevant addresses from the root addresses by default relies on pulling verified contract ABIs.
Verification happens normally as part of the deploy command-line task (the same command triggered by the `deploy-market` workflow).
Since deployments are idempotent by default, the deploy command can also be used to *just* verify the existing contracts (an explicit way to do this is via the `--no-deploy` flag).
When all contracts are already deployed, the only actions performed will be to verify the contracts remaining in the verification cache.
The script *always* attempts to verify the Comet implementation contract, since this is deployed via a factory and the status is relatively unknown to it.

The `--simulate` flag can be used when running deploy to check what the effect of running a deploy would actually be, including verification.
This can also be used together with `--overwrite`, to produce the verification artifacts locally, which can then be used to run full verification for real.

#### Other considerations

Make sure that the deploying address has a sufficient amount of the chain's
native asset (i.e. 2 ETH for Goerli, 2 AVAX for Fuji)

### Clone Multisig

The `clone-multisig` script can be used to clone the multisig and its configuration from an existing deployment, e.g.:

```bash
DST_NETWORK=optimism npx hardhat run scripts/clone-multisig.ts
```

### Liquidation Bot

This repo includes a contract (Liquidator.sol) that will absorb an underwater
position, purchase the absorbed collateral, and then attempt to sell it on
Uniswap for a profit.

To run the bot, you'll need the address of a deployed version of the Liquidator
contract (or you can deploy a new instance of it yourself):

`LIQUIDATOR_ADDRESS="0xABC..." DEPLOYMENT="usdc" yarn liquidation-bot --network goerli`

Initiating transactions this way via the public mempool will
[almost certainly get frontrun](https://youtu.be/UZ-NNd6yjFM), but you might be
able to use [flashbots](https://docs.flashbots.net/) to mask your transactions
from frontrunners.
