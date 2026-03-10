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
BASESCAN_KEY=<key>           # For Base network verification
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

Currently, the following networks are supported:
- Ethereum mainnet and testnet (sepolia)
- Avalanche mainnet and testnet (fuji)
- Base mainnet
- Arbitrum
- Optimism
- Polygon
- And more...

To use this project with other chains, the block explorer API key for your target chain must be set in .env:
- `SNOWTRACE_KEY` for Avalanche
- `BASESCAN_KEY` for Base
- `ARBISCAN_KEY` for Arbitrum
- `OPTIMISTIC_ETHERSCAN_KEY` for Optimism
- `POLYGONSCAN_KEY` for Polygon

An example deployment command looks like:

`yarn hardhat deploy --network fuji --deployment usdc`

### Base Network Deployments

Compound III is deployed on Base mainnet with the following markets:

| Market | Comet Address | Configurator | Rewards |
|--------|--------------|--------------|---------|
| USDC | 0xb125E6687d4313864e53df431d5425969c15Eb2F | 0x45939657d1CA34A8FA39A924B71D28Fe8431e581 | 0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1 |
| USDbC | 0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf | 0x45939657d1CA34A8FA39A924B71D28Fe8431e581 | 0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1 |
| WETH | 0x46e6b214b524310239732D51387075E0e70970bf | 0x45939657d1CA34A8FA39A924B71D28Fe8431e581 | 0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1 |

To interact with Base deployments:

`yarn hardhat deploy --network base --deployment usdc`

## Comet protocol contracts

**[Comet.sol](https://github.com/compound-finance/comet/blob/main/contracts/Comet.sol)** - Contract that inherits `CometMainInterface.sol` and is the implementation for most of Comet's core functionalities. A small set of functions that do not fit within this contract are implemented in `CometExt.sol` instead, which Comet `DELEGATECALL`s to for unrecognized function signatures.

**[CometExt.sol](https://github.com/compound-finance/comet/blob/main/contracts/CometExt.sol)** - Contract that inherits `CometExtInterface.sol` and is the implementation for extra functions that do not fit within `Comet.sol`, such as `approve`.

**[CometInterface.sol](https://github.com/compound-finance/comet/blob/main/contracts/CometInterface.sol)** - Abstract con...(truncated)