import { Constraint, Solution } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { expect } from 'chai';
import { Requirements } from './Requirements';
import { exp } from '../../test/helpers';
import { ComparisonOp, getAssetFromName, parseAmount } from '../utils';

export class SupplyCapConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, _initialContext: T) {
    let supplyCaps = requirements.supplyCaps;
    if (typeof supplyCaps === 'function') {
      supplyCaps = await supplyCaps(_initialContext);
    }
    if (supplyCaps !== undefined) {
      const solutions: Solution<T>[] = [];
      solutions.push(async function barelyMeet(context: T) {
        const supplyAmountPerAsset = {};
        for (const [assetName, rawAmount] of Object.entries(supplyCaps)) {
          const asset = await getAssetFromName(assetName, context);
          const decimals = await asset.token.decimals();
          const amount = parseAmount(rawAmount);
          expect(amount.op).to.equal(ComparisonOp.GTE, `Operation ${amount.op} not supported (yet) by supply cap constraint`);
          supplyAmountPerAsset[asset.address] = exp(amount.val, decimals);
        }
        await context.bumpSupplyCaps(supplyAmountPerAsset);
        return context;
      });
      return solutions;
    } else {
      return null;
    }
  }

  async check(requirements: R, context: T) {
    const supplyCaps = requirements.supplyCaps;
    if (supplyCaps !== undefined) {
      const comet = await context.getComet();
      for (const [assetName, rawAmount] of Object.entries(supplyCaps)) {
        const asset = await getAssetFromName(assetName, context);
        const assetInfo = await comet.getAssetInfoByAddress(asset.address);
        const decimals = await asset.token.decimals();
        const amount = parseAmount(rawAmount);
        const actualCap = assetInfo.supplyCap.toBigInt();
        const expectedCap = exp(amount.val, decimals);
        switch (amount.op) {
          case ComparisonOp.EQ:
            expect(actualCap).to.equal(expectedCap);
            break;
          case ComparisonOp.GTE:
            expect(actualCap).to.be.at.least(expectedCap);
            break;
          case ComparisonOp.LTE:
            expect(actualCap).to.be.at.most(expectedCap);
            break;
          case ComparisonOp.GT:
            expect(actualCap).to.be.above(expectedCap);
            break;
          case ComparisonOp.LT:
            expect(actualCap).to.be.below(expectedCap);
            break;
        }
      }
    }
  }
}