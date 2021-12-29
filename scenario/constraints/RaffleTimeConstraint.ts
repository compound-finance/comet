import { Constraint, Scenario, Solution, World } from '../../plugins/scenario';
import { CometContext } from '../CometContext';

export enum RaffleTime {
  NotOver = 0,
  Over = 1,
}

function randomInt(min: number, max: number) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min);
}

class RaffleTimeConstraint<T extends CometContext> implements Constraint<T> {
  async solve(requirements, _context, world) {

    const desiredTime = requirements?.raffle?.time;
    if (desiredTime === null) {
      return null;
    }

    return async (context: CometContext) => {
      const { actors } = context;
      const { admin } = actors;
      const raffle = context.contracts().raffle;

      const endTime = (await raffle.endTime()).toNumber();
      const currentTime = await world.timestamp();

      if (currentTime > endTime && desiredTime == RaffleTime.NotOver) {
        console.log('attempting to restart the Raffle');

        await admin.determineWinner();
        await admin.restartRaffle({
          ticketPrice: randomInt(1, 9999999),
          duration: randomInt(1, 9999999)
        });
      } else if (currentTime <= endTime && desiredTime == RaffleTime.Over) {
        await world.increaseTime(endTime - currentTime);
      }
    }
  }

  async check(requirements: object, context: T, world: World) {
    return; // XXX
  }
}

export default RaffleTimeConstraint;