import { exp, makeProtocol, wait } from '../helpers';
import { Supplier } from './actors/Supplier';
import { Actor } from './actors/Actor';
import { Market } from './Market';
import { simulate } from './Simulate.ts';
import { World } from './World';
import { Borrower } from './actors/Borrower';

// XXX doesn't have to be under the unit test directory. can be a standalone script
describe.only('run simulation', function () {
  it('simulation with 15 actors', async () => {
    const params = {
      interestRateBase: exp(0.005, 18),
      interestRateSlopeLow: exp(0.3, 18),
      interestRateSlopeHigh: exp(3, 18),
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
      }
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
      await wait(market.baseAsset.allocateTo(actor.signer.address, exp(100_000_000, 6)));
      // Seed actor with collateral in Comet to have very high borrowing capacity
      await wait(market.collateralAsset.allocateTo(actor.signer.address, exp(100_000_000, 18)));
      await actor.supply(market, market.collateralAsset, exp(100_000_000, 18));
    }

    // Seed market with initial supply and borrow positions
    const initialSupplier = actors[0];
    const initialBorrower = actors[numSuppliers];
    await initialSupplier.supply(market, market.baseAsset, exp(10_000_000, 6));
    await initialBorrower.borrow(market, market.baseAsset, exp(8_000_000, 6));

    const snapshots = await simulate(world, market, actors.slice(2), 20);
    snapshots.forEach(s => console.log(s));

    // XXX add some data visualization for the snapshots
  });
});