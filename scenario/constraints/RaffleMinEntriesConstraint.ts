import { Constraint, Scenario, Solution, World } from '../../plugins/scenario';
import { CometContext } from '../CometContext';

function randomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

class RaffleMinEntriesConstraint<T extends CometContext>
  implements Constraint<T>
{
  async solve(requirements, _context, _world) {
    const minEntries = requirements?.raffle?.minEntries || 0;

    if (minEntries === null) {
      return null;
    }

    return async (context: CometContext) => {
      const { actors } = context;
      const raffle = context.contracts().raffle;

      let playerCount = (await context.players()).length;
      const actorNames = Object.keys(actors);
      const ticketPrice = await raffle.ticketPrice();

      while (playerCount < minEntries) {
        const randomActorName = randomElement(actorNames);
        await actors[randomActorName].enterWithEth(ticketPrice);
        playerCount = (await context.players()).length;
      }
    };
  }

  async check(requirements: object, context: T, world: World) {
    return; // XXX
  }
}

export default RaffleMinEntriesConstraint;
