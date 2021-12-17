# Compound Comet

## Getting started

1. Clone the repo
2. Run `yarn install`

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

### Run spider task

The spider script programmatically fetches all protocol-related contracts from mainnet.
This is just a prototype and it currently pulls relevant contracts for V2.

> Note: Make sure $ETHERSCAN_KEY is set in your `.env`.

`npx hardhat spider --network mainnet`

### Scenarios

Scenarios are high-level property and ad-hoc tests for the Comet protocol. To run and check scenarios:

`npx hardhat scenario`

#### Scenario CLI

You can run scenarios against a given base as:

`npx hardhat scenario --base mainnet --base avax`

#### New Scenarios

To add a new scenario, add to `scenario/`, e.g.

**scenario/NewToken.ts**

```ts
import { scenario, World } from '../plugins/scenario';
import { CometContext } from './Context';
import { expect } from 'chai';

scenario("add eth token 0x...", { remote_token: "eth-mainnet@0x..." }, async ({user, oracle, comet, remoteToken}: CometContext, world: World) => {
  await oracle.setPrice(remoteToken, 100);
  await comet.support(remoteToken);
  await comet.supply(user, 100, remoteToken);
  await comet.borrow(user, 1000);
  expect(await comet.collateralBalance(user, remoteToken)).to.equal(100);
  expect(await comet.borrowBalance(user)).to.equal(1000);
});
````

For more information, see the Scenarios Hardhat plugin.
