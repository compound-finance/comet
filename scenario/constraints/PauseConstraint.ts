import { Constraint, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { expect } from 'chai';
import { Requirements } from './Requirements';
import { utils } from "ethers";

export class PauseConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, context: T, world: World) {
    const pauseRequirements = requirements.pause;
    if (!pauseRequirements) {
      return null;
    }

    const comet = await context.getComet();

    if (typeof pauseRequirements['all'] !== 'undefined') {
      return async (context: CometContext) => {
        const isPaused = pauseRequirements['all'];
        const pauseCalldata = utils.defaultAbiCoder.encode(
          ["bool", "bool", "bool", "bool", "bool"],
          [isPaused, isPaused, isPaused, isPaused, isPaused]
        );
        await context.fastGovernanceExecute(
          [comet.address],
          [0],
          ["pause(bool,bool,bool,bool,bool)"],
          [pauseCalldata]
        );
      };
    } else {
      return async (context: CometContext) => {
        const supplyPaused = pauseRequirements['supplyPaused'] ?? false;
        const transferPaused = pauseRequirements['transferPaused'] ?? false;
        const withdrawPaused = pauseRequirements['withdrawPaused'] ?? false;
        const absorbPaused = pauseRequirements['absorbPaused'] ?? false;
        const buyPaused = pauseRequirements['buyPaused'] ?? false;

        const pauseCalldata = utils.defaultAbiCoder.encode(
          ["bool", "bool", "bool", "bool", "bool"],
          [supplyPaused, transferPaused, withdrawPaused, absorbPaused, buyPaused]
        );
        await context.fastGovernanceExecute(
          [comet.address],
          [0],
          ["pause(bool,bool,bool,bool,bool)"],
          [pauseCalldata]
        );
      };
    }
  }

  async check(requirements: R, context: T, world: World) {
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
