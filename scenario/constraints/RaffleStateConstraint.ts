import { Constraint, Scenario, Solution, World } from '../../plugins/scenario';
import { CometContext } from '../CometContext';

export enum RaffleState {
  Active = 0,
  Finished = 1,
}

function randomInt(min: number, max: number) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min);
}

class RaffleStateConstraint<T extends CometContext> implements Constraint<T> {
  async solve(requirements, _context, world) {
    const desiredState = requirements?.raffle?.state;
    if (desiredState === null) {
      return null;
    }

    return async (context: CometContext) => {
      const { actors } = context;
      const { admin } = actors;
      const raffle = context.contracts().raffle;

      const currentState = await raffle.state();

      if (currentState == RaffleState.Active && desiredState == RaffleState.Finished) {
        console.log('attempting to deactivate Raffle');

        const endTime = (await raffle.endTime()).toNumber();
        const currentTime = await world.timestamp();

        // advance time past endtime
        if (currentTime < endTime) {
          await world.increaseTime(endTime - currentTime);
        }

        await admin.determineWinner();
      } else if (currentState == RaffleState.Finished && desiredState == RaffleState.Active) {
        console.log('attempting to restart Raffle');
        await admin.restartRaffle({
          ticketPrice: randomInt(1, 9999999),
          duration: randomInt(1, 9999999),
        });
      }
    };
  }

  async check(requirements: object, context: T, world: World) {
    return; // XXX
  }
}

export default RaffleStateConstraint;
