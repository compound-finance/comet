import { Constraint, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { expect } from 'chai';
import { Requirements } from './Requirements';

export class PauseConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, _context: T) {
    const pauseRequirements = requirements.pause;
    if (!pauseRequirements) {
      return null;
    }

    if (typeof pauseRequirements['all'] !== 'undefined') {
      return async (ctx: CometContext) => {
        const pauseGuardian = ctx.actors['pauseGuardian'];
        const isPaused = pauseRequirements['all'];

        await ctx.setNextBaseFeeToZero();
        await pauseGuardian.pause({
          supplyPaused: isPaused,
          transferPaused: isPaused,
          withdrawPaused: isPaused,
          absorbPaused: isPaused,
          buyPaused: isPaused,
        }, { gasPrice: 0 });
      };
    } else {
      return async (ctx: CometContext) => {
        const pauseGuardian = ctx.actors['pauseGuardian'];
        const supplyPaused = pauseRequirements['supplyPaused'] ?? false;
        const transferPaused = pauseRequirements['transferPaused'] ?? false;
        const withdrawPaused = pauseRequirements['withdrawPaused'] ?? false;
        const absorbPaused = pauseRequirements['absorbPaused'] ?? false;
        const buyPaused = pauseRequirements['buyPaused'] ?? false;

        await ctx.setNextBaseFeeToZero();
        await pauseGuardian.pause({
          supplyPaused,
          transferPaused,
          withdrawPaused,
          absorbPaused,
          buyPaused,
        }, { gasPrice: 0 });
      };
    }
  }

  async check(requirements: R, context: T, _world: World) {
    const pauseRequirements = requirements.pause;
    if (!pauseRequirements) {
      return;
    }

    let comet = await context.getComet();
    if (typeof pauseRequirements['all'] !== 'undefined') {
      const isPaused = pauseRequirements['all'];
      expect(await comet.isSupplyPaused()).to.be.equals(isPaused);
      expect(await comet.isTransferPaused()).to.be.equals(isPaused);
      expect(await comet.isWithdrawPaused()).to.be.equals(isPaused);
      expect(await comet.isAbsorbPaused()).to.be.equals(isPaused);
      expect(await comet.isBuyPaused()).to.be.equals(isPaused);
    } else {
      const supplyPaused = pauseRequirements['supplyPaused'] ?? false;
      const transferPaused = pauseRequirements['transferPaused'] ?? false;
      const withdrawPaused = pauseRequirements['withdrawPaused'] ?? false;
      const absorbPaused = pauseRequirements['absorbPaused'] ?? false;
      const buyPaused = pauseRequirements['buyPaused'] ?? false;

      expect(await comet.isSupplyPaused()).to.be.equals(supplyPaused);
      expect(await comet.isTransferPaused()).to.be.equals(transferPaused);
      expect(await comet.isWithdrawPaused()).to.be.equals(withdrawPaused);
      expect(await comet.isAbsorbPaused()).to.be.equals(absorbPaused);
      expect(await comet.isBuyPaused()).to.be.equals(buyPaused);
    }
  }
}
