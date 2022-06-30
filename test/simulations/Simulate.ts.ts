import { Actor } from "./actors/Actor";
import { Market } from "./Market";
import { World } from "./World";

function shuffle(iter) {
  return iter; // XXX
}

async function snapshot(world: World, market: Market) {
  return {
    world: await world.prevailingRates(),
    market: { ...(await market.currentRates()), ...(await market.currentTvl()) },
  }
}

export async function simulate(world: World, market: Market, actors: Actor[], runs: number) {
  const snapshots = [await snapshot(world, market)];
  for (let t = 0; t < runs; t++) {
    // XXX can change world state in between runs, such as prevailing rates, market sentiment, etc.
    for (const actor of shuffle(actors)) {
      await actor.act(world, market, t);
      snapshots.push(await snapshot(world, market));
    }
  }
  return snapshots;
}