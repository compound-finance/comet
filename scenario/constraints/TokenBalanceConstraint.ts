import { Constraint, Solution } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { expect } from 'chai';
import { Requirements } from './Requirements';
import { BigNumber } from 'ethers';
import { exp } from '../../test/helpers';
import { ComparativeAmount, ComparisonOp, getActorAddressFromName, getAssetFromName, parseAmount, getToTransferAmount } from '../utils';

export class TokenBalanceConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, initialContext: T) {
    let assetsByActor = requirements.tokenBalances;
    if (typeof assetsByActor === 'function') {
      assetsByActor = await assetsByActor(initialContext);
    }
    if (assetsByActor) {
      const actorsByAsset = Object.entries(assetsByActor).reduce((a, [actor, assets]) => {
        return Object.entries(assets).reduce((a, [asset, rawAmount]) => {
          const v = a[asset] || {};
          a[asset] = { [actor]: parseAmount(rawAmount), ...v };
          return a;
        }, a);
      }, {});

      // XXX ideally we do for each actor:
      //  if lt or lte: lt solution
      //  if gt or gte: gt solution
      //  if gte or lte or eq: eq solution
      //  but its combinatorial

      // XXX ideally when properties fail
      //  we can report the names of the solution which were applied
      const solutions: Solution<T>[] = [];
      solutions.push(async function barelyMeet(context: T) {
        for (const assetName in actorsByAsset) {
          const asset = await getAssetFromName(assetName, context);
          for (const actorName in actorsByAsset[assetName]) {
            const actor = await getActorAddressFromName(actorName, context);
            const amount: ComparativeAmount = actorsByAsset[assetName][actorName];
            const balance = await asset.balanceOf(actor);
            const decimals = await asset.token.decimals();
            const toTransfer = getToTransferAmount(amount, balance, decimals);
            await context.sourceTokens(toTransfer, asset.address, actor);
          }
        }
        return context;
      });
      return solutions;
    } else {
      return null;
    }
  }

  async check(requirements: R, context: T) {
    const assetsByActor = requirements.tokenBalances;
    if (assetsByActor) {
      for (const [actorName, assets] of Object.entries(assetsByActor)) {
        for (const [assetName, rawAmount] of Object.entries(assets)) {
          const actor = await getActorAddressFromName(actorName, context);
          const asset = await getAssetFromName(assetName, context);
          const amount = parseAmount(rawAmount);
          const balance = BigNumber.from(await asset.balanceOf(actor));
          const decimals = await asset.token.decimals();
          switch (amount.op) {
            case ComparisonOp.EQ:
              expect(balance).to.equal(exp(amount.val, decimals));
              break;
            case ComparisonOp.GTE:
              expect(balance).to.be.at.least(exp(amount.val, decimals));
              break;
            case ComparisonOp.LTE:
              expect(balance).to.be.at.most(exp(amount.val, decimals));
              break;
            case ComparisonOp.GT:
              expect(balance).to.be.above(exp(amount.val, decimals));
              break;
            case ComparisonOp.LT:
              expect(balance).to.be.below(exp(amount.val, decimals));
              break;
          }
        }
      }
    }
  }
}