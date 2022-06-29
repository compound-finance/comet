import { exp, makeProtocol, wait } from '../helpers';
import { Actor } from './Actor';
import { Market } from './Market';
import { simulate } from './Simulate.ts';
import { World } from './World';

describe.only('run simulation', function () {
  it('simulation with multiple actors', async () => {
    const params = {
      interestRateBase: exp(0.005, 18),
      interestRateSlopeLow: exp(0.3, 18),
      interestRateSlopeHigh: exp(3, 18),
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
      }
    };
    const protocol = await makeProtocol(params);
    const { users } = protocol;

    const world = new World();
    const market = new Market(protocol);
    let actors: Actor[] = [];
    // XXX alternative: we manually create each actor since they need different params
    for (let i = 0; i < 10 + 2; i++) { // XXX input should take # of actors
      const actor = new Actor(users[i]);
      actors.push(actor);
      // Seed actor with base
      await wait(market.baseAsset.allocateTo(actor.signer.address, exp(10_000_000, 6)));
      // Seed actor with collateral in Comet to have very high borrowing capacity
      await wait(market.collateralAsset.allocateTo(actor.signer.address, exp(100_000_000, 18)));
      await actor.supply(market, market.collateralAsset, exp(100_000_000, 18));
    }

    // Seed market with initial supply and borrow positions
    // Alice (supplier) and Bob (borrower) will not act for the rest of the simulation
    const [alice, bob] = actors;
    await alice.supply(market, market.baseAsset, exp(5_000_000, 6));
    await bob.borrow(market, market.baseAsset, exp(4_000_000, 6));

    const snapshots = await simulate(world, market, actors.slice(2), 2);
    console.log('Snapshots: ', snapshots)
  });
});