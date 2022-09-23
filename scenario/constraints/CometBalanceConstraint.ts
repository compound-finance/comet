import { Constraint } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import CometActor from '../context/CometActor';
import { expect } from 'chai';
import { Requirements } from './Requirements';
import { baseBalanceOf, exp, factorScale } from '../../test/helpers';
import { ComparativeAmount, ComparisonOp, getAssetFromName, parseAmount, getExpectedBaseBalance, getToTransferAmount } from '../utils';
import { BigNumber } from 'ethers';

async function borrowBase(borrowActor: CometActor, toBorrowBase: bigint, context: CometContext) {
  const comet = await context.getComet();
  // XXX only use collaterals that are not specified in the requirement or have `gte`
  const { asset: collateralAsset, borrowCollateralFactor, priceFeed, scale } = await comet.getAssetInfo(0);

  const collateralToken = context.getAssetByAddress(collateralAsset);
  const baseTokenAddress = await comet.baseToken();

  const basePrice = (await comet.getPrice(await comet.baseTokenPriceFeed())).toBigInt();
  const collateralPrice = (await comet.getPrice(priceFeed)).toBigInt();

  const baseScale = (await comet.baseScale()).toBigInt();
  const collateralScale = scale.toBigInt();

  const collateralWeiPerUnitBase = (collateralScale * basePrice) / collateralPrice;
  let collateralNeeded = (collateralWeiPerUnitBase * toBorrowBase) / baseScale;
  collateralNeeded = (collateralNeeded * factorScale) / borrowCollateralFactor.toBigInt(); // adjust for borrowCollateralFactor
  collateralNeeded = (collateralNeeded * 11n) / 10n; // add fudge factor

  await context.sourceTokens(collateralNeeded, collateralToken, borrowActor);
  await collateralToken.approve(borrowActor, comet);
  await borrowActor.safeSupplyAsset({ asset: collateralToken.address, amount: collateralNeeded });
  await borrowActor.withdrawAsset({ asset: baseTokenAddress, amount: toBorrowBase });
}

export class CometBalanceConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, _initialContext: T) {
    const assetsByActor = requirements.cometBalances;
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
      const solutions = [];
      solutions.push(async function barelyMeet(context: T) {
        const comet = await context.getComet();
        for (const assetName in actorsByAsset) {
          const asset = await getAssetFromName(assetName, context);
          for (const actorName in actorsByAsset[assetName]) {
            const actor = context.actors[actorName];
            const amount: ComparativeAmount = actorsByAsset[assetName][actorName];
            const cometBalance = (await comet.collateralBalanceOf(actor.address, asset.address)).toBigInt();
            const decimals = await asset.token.decimals();
            const toTransfer = getToTransferAmount(amount, cometBalance, decimals);
            if (toTransfer > 0) {
              // Case: Supply asset
              // 1. Source tokens to user
              await context.sourceTokens(toTransfer, asset.address, actor.address);
              // 2. Supply tokens to Comet
              // Note: but will interest rates cause supply/borrow to not exactly match the desired amount?
              await asset.approve(actor, comet.address);
              await actor.safeSupplyAsset({ asset: asset.address, amount: toTransfer });
            } else if (toTransfer < 0) {
              const toWithdraw = -toTransfer;
              const baseToken = await context.getAssetByAddress(await comet.baseToken());
              if (asset === baseToken) {
                // Case: Withdraw base asset
                // 1. Calculate Comet's base balance shortfall
                const cometBaseBalance = await baseToken.balanceOf(comet.address);
                const cometBaseBalanceShortfall = toWithdraw - cometBaseBalance;
                // 2. If there is a shortfall, make up for it by sourcing base tokens to Comet
                if (cometBaseBalanceShortfall > 0) {
                  await context.sourceTokens(cometBaseBalanceShortfall, baseToken.address, comet.address);
                }
                // 3. Borrow base (will supply collateral if needed to borrow)
                await borrowBase(actor, -toTransfer, context);
              } else {
                // Case: Withdraw collateral asset
                // 1. Withdraw collateral
                await actor.withdrawAsset({ asset: asset.address, amount: toWithdraw });
              }
            }
          }
        }
        return context;
      });
      return solutions;
    }
  }

  async check(requirements: R, context: T) {
    const assetsByActor = requirements.cometBalances;
    if (assetsByActor) {
      const comet = await context.getComet();
      for (const [actorName, assets] of Object.entries(assetsByActor)) {
        for (const [assetName, rawAmount] of Object.entries(assets)) {
          const actor = context.actors[actorName];
          const asset = await getAssetFromName(assetName, context);
          const amount = parseAmount(rawAmount);
          const decimals = await asset.token.decimals();
          const baseToken = await comet.baseToken();
          // Chai matchers (like `.to.be.at.most()`) only work for numbers and
          // BigNumbers, so we convert from BigInt to BigNumber
          let actualBalance: BigNumber;
          let expectedBalance: BigNumber;
          if (asset.address === baseToken) {
            actualBalance = BigNumber.from(await baseBalanceOf(comet, actor.address));
            const baseIndexScale = (await comet.baseIndexScale()).toBigInt();
            let baseIndex;
            if (amount.val >= 0) {
              baseIndex = (await comet.totalsBasic()).baseSupplyIndex.toBigInt();
            } else {
              baseIndex = (await comet.totalsBasic()).baseBorrowIndex.toBigInt();
            }
            expectedBalance = BigNumber.from(getExpectedBaseBalance(exp(amount.val, decimals), baseIndexScale, baseIndex));
          } else {
            actualBalance = BigNumber.from(await comet.collateralBalanceOf(actor.address, asset.address));
            expectedBalance = BigNumber.from(exp(amount.val, decimals));
          }
          switch (amount.op) {
            case ComparisonOp.EQ:
              expect(actualBalance).to.equal(expectedBalance);
              break;
            case ComparisonOp.GTE:
              expect(actualBalance).to.be.at.least(expectedBalance);
              break;
            case ComparisonOp.LTE:
              expect(actualBalance).to.be.at.most(expectedBalance);
              break;
            case ComparisonOp.GT:
              expect(actualBalance).to.be.above(expectedBalance);
              break;
            case ComparisonOp.LT:
              expect(actualBalance).to.be.below(expectedBalance);
              break;
          }
        }
      }
    }
  }
}