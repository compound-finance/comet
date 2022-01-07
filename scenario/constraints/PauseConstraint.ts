import { Constraint, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { expect } from 'chai';

export class PauseConstraint<T extends CometContext> implements Constraint<T> {
  async solve(requirements: object, context: T, world: World) {
    const pauseRequirements = requirements['pause'];
    if (!pauseRequirements) {
      return null;
    }
    if (typeof pauseRequirements['all'] !== 'undefined') {
      return async (context: CometContext) => {
        const { actors } = context;
        const { admin } = actors;

        const isPaused = pauseRequirements['all'];
        await admin.pause({
          supplyPaused: isPaused,
          transferPaused: isPaused,
          withdrawPaused: isPaused,
          absorbPaused: isPaused,
          buyPaused: isPaused,
        });
      };
    } else {
      return async (context: CometContext) => {
        const { actors } = context;
        const { admin } = actors;

        const supplyPaused = pauseRequirements['supplyPaused'] ?? false;
        const transferPaused = pauseRequirements['transferPaused'] ?? false;
        const withdrawPaused = pauseRequirements['withdrawPaused'] ?? false;
        const absorbPaused = pauseRequirements['absorbPaused'] ?? false;
        const buyPaused = pauseRequirements['buyPaused'] ?? false;
        await admin.pause({
          supplyPaused,
          transferPaused,
          withdrawPaused,
          absorbPaused,
          buyPaused,
        });
      };
    }
  }

  async check(requirements: object, context: T, world: World) {
    const pauseRequirements = requirements['pause'];
    if (!pauseRequirements) {
      return null;
    }
    if (typeof pauseRequirements['all'] !== 'undefined') {
      const isPaused = pauseRequirements['all'];

      expect(await context.comet.isSupplyPaused()).to.be.equals(isPaused);
      expect(await context.comet.isTransferPaused()).to.be.equals(isPaused);
      expect(await context.comet.isWithdrawPaused()).to.be.equals(isPaused);
      expect(await context.comet.isAbsorbPaused()).to.be.equals(isPaused);
      expect(await context.comet.isBuyPaused()).to.be.equals(isPaused);
    } else {
      const supplyPaused = pauseRequirements['supplyPaused'] ?? false;
      const transferPaused = pauseRequirements['transferPaused'] ?? false;
      const withdrawPaused = pauseRequirements['withdrawPaused'] ?? false;
      const absorbPaused = pauseRequirements['absorbPaused'] ?? false;
      const buyPaused = pauseRequirements['buyPaused'] ?? false;

      expect(await context.comet.isSupplyPaused()).to.be.equals(supplyPaused);
      expect(await context.comet.isTransferPaused()).to.be.equals(transferPaused);
      expect(await context.comet.isWithdrawPaused()).to.be.equals(withdrawPaused);
      expect(await context.comet.isAbsorbPaused()).to.be.equals(absorbPaused);
      expect(await context.comet.isBuyPaused()).to.be.equals(buyPaused);
    }
  }
}
