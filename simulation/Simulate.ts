import { Actor } from './actors/Actor';
import { Market } from './Market';
import { World } from './World';

/* Randomize array in-place using Durstenfeld shuffle algorithm */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

async function snapshot(world: World, market: Market, round: number) {
  const rates = await market.currentRates();
  const tvl = await market.currentTvl();
  const protocolProfit = Number(tvl.totalBorrow) * rates.borrowRate - Number(tvl.totalSupply) * rates.supplyRate;
  return {
    world: await world.prevailingRates(),
    market: { ...(await market.currentRates()), ...(await market.currentTvl()), annualProfit: protocolProfit },
    round,
  };
}

function hasMarketChanged(oldMarket, currentMarket) {
  if (oldMarket !== null &&
    oldMarket.market.totalSupply === currentMarket.market.totalSupply &&
    oldMarket.market.totalBorrow === currentMarket.market.totalBorrow) {
    return false;
  } else {
    return true;
  }
}

export async function simulate(world: World, market: Market, actors: Actor[], maxRounds: number) {
  const snapshots = [await snapshot(world, market, 0)];
  let lastRoundSnapshot = null;
  for (let t = 0; t < maxRounds; t++) {
    // Exit early if the market has not changed since the beginning of the last round
    const currentRoundSnapshot = await snapshot(world, market, t);
    if (!hasMarketChanged(lastRoundSnapshot, currentRoundSnapshot)) {
      return snapshots;
    }
    lastRoundSnapshot = currentRoundSnapshot;

    // XXX can change world state in between runs, such as prevailing rates, market sentiment, etc.
    shuffle(actors);
    for (const actor of actors) {
      await actor.act(world, market, t);
      snapshots.push(await snapshot(world, market, t));
    }
  }
  return snapshots;
}