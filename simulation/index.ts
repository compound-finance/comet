import { exp, makeProtocol, wait } from '../test/helpers';
import { Supplier } from './actors/Supplier';
import { Actor } from './actors/Actor';
import { Market } from './Market';
import { simulate } from './Simulate';
import { World } from './World';
import { Borrower } from './actors/Borrower';

const interestRateParams = {
  supplyKink: exp(0.8, 18),
  supplyInterestRateBase: exp(0, 18),
  supplyInterestRateSlopeLow: exp(0.04, 18),
  supplyInterestRateSlopeHigh: exp(0.4, 18),
  borrowKink: exp(0.9, 18),
  borrowInterestRateBase: exp(0.01, 18),
  borrowInterestRateSlopeLow: exp(0.05, 18),
  borrowInterestRateSlopeHigh: exp(0.3, 18),
};

export async function runSimulation(irParams) {
  const params = {
    baseTrackingBorrowSpeed: exp(0.005092592593, 15), // 440 COMP/day
    baseBorrowMin: 0n,
    assets: {
      USDC: {
        initial: 1e6,
        decimals: 6,
        initialPrice: 1,
      },
      WETH: {
        initial: 1e6,
        decimals: 18,
        initialPrice: 2000,
        supplyCap: exp(1_000_000_000_000, 18),
      },
      COMP: {
        initial: 1e6,
        decimals: 18,
        initialPrice: 50,
      },
    },
    ...irParams
  };
  const protocol = await makeProtocol(params);
  const { users } = protocol;

  const world = new World();
  const market = new Market(protocol);
  let actors: Actor[] = [];
  let numSuppliers = 10;
  let numBorrowers = 5;
  // XXX alternative: we can manually create each actor to provide them with different params
  // For now, let's keep it simple: ~10 suppliers and ~5 borrowers
  for (let i = 0; i < numSuppliers + numBorrowers; i++) { // XXX input should take # of actors
    let actor;
    if (i < numSuppliers) actor = new Supplier(users[i]);
    else actor = new Borrower(users[i]);
    actors.push(actor);
    // Seed actor with base
    await wait(market.baseAsset.allocateTo(actor.signer.address, exp(1_000_000_000, 6)));
    // Seed actor with collateral in Comet to have very high borrowing capacity
    await wait(market.collateralAsset.allocateTo(actor.signer.address, exp(1_000_000_000, 18)));
    await actor.supply(market, market.collateralAsset, exp(1_000_000_000, 18));
  }

  // Seed market with initial supply and borrow positions
  const initialSupplier = actors[0];
  const initialBorrower = actors[numSuppliers];
  await initialSupplier.supply(market, market.baseAsset, exp(10_000_000, 6));
  await initialBorrower.borrow(market, market.baseAsset, exp(8_000_000, 6));

  const snapshots = await simulate(world, market, actors.slice(2), 50);
  return snapshots;

  // XXX add some data visualization for the snapshots
}

// Runs the simulation multiple times, each time adjusting a single IR parameter from the default
// set of parameters
export async function run() {
  const supplySlopeLowParams = [
    { ...interestRateParams, supplyInterestRateSlopeLow: exp(0.03, 18) },
    { ...interestRateParams, supplyInterestRateSlopeLow: exp(0.035, 18) },
    { ...interestRateParams, supplyInterestRateSlopeLow: exp(0.04, 18) },
  ];
  const borrowSlopeLow = [
    { ...interestRateParams, borrowInterestRateSlopeLow: exp(0.04, 18) },
    { ...interestRateParams, borrowInterestRateSlopeLow: exp(0.045, 18) },
    { ...interestRateParams, borrowInterestRateSlopeLow: exp(0.05, 18) },
  ];
  const borrowBase = [
    { ...interestRateParams, borrowInterestRateBase: exp(0.0, 18) },
    { ...interestRateParams, borrowInterestRateBase: exp(0.005, 18) },
    { ...interestRateParams, borrowInterestRateBase: exp(0.01, 18) },
  ];
  // const custom = [
  //   { ...interestRateParams, supplyInterestRateSlopeLow: exp(0.035, 18), borrowInterestRateSlopeLow: exp(0.09, 18) },
  // ];

  console.log('===== Adjusting supply rate slope low =====');
  for (let params of supplySlopeLowParams) {
    const snapshot = (await runSimulation(params)).slice(-1)[0];
    console.log('Equilibrium for supply slope low: ', params.supplyInterestRateSlopeLow);
    console.log(snapshot);
  }

  console.log('===== Adjusting borrow rate slope low =====');
  for (let params of borrowSlopeLow) {
    const snapshot = (await runSimulation(params)).slice(-1)[0];
    console.log('Equilibrium for borrow slope low: ', params.borrowInterestRateSlopeLow);
    console.log(snapshot);
  }

  console.log('===== Adjusting borrow rate base =====');
  for (let params of borrowBase) {
    const snapshot = (await runSimulation(params)).slice(-1)[0];
    console.log('Equilibrium for borrow base: ', params.borrowInterestRateBase);
    console.log(snapshot);
  }

  // console.log('===== Custom adjustments =====')
  // for (let params of custom) {
  //   const snapshot = (await runSimulation(params)).slice(-1)[0];
  //   console.log('Equilibrium for custom: ')
  //   console.log(snapshot)
  // }

  // XXX output some CSV with these
}