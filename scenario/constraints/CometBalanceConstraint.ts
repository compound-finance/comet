import { Constraint, Scenario, Solution, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import CometActor from '../context/CometActor';
import { expect } from 'chai';
import { Requirements } from './Requirements';
import { exp, factorScale } from '../../test/helpers';
import { getAssetFromName, parseAmount } from './utils';

async function borrowBase(borrowActor: CometActor, toBorrowBase: bigint, world: World, context: CometContext) {
  const comet = await context.getComet();
  // XXX getting the first collateral might not be always correct
  const { asset: collateralAsset, borrowCollateralFactor, priceFeed, scale } = await comet.getAssetInfo(0);

  console.log('attempting to borrow')

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

  await context.sourceTokens(world, collateralNeeded, collateralToken, borrowActor);
  console.log('sourced collateral ', collateralNeeded, await collateralToken.token.symbol())
  await collateralToken.approve(borrowActor, comet);
  await borrowActor.supplyAsset({ asset: collateralToken.address, amount: collateralNeeded });
  console.log('supplied collateral token')
  console.log(`attempting to borrow ${toBorrowBase} base from remaining ${await context.getAssetByAddress(baseTokenAddress).balanceOf(comet.address)}`)
  await borrowActor.withdrawAsset({ asset: baseTokenAddress, amount: toBorrowBase });
  console.log('withdrew base token')
}

export class CometBalanceConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, initialContext: T, initialWorld: World) {
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
      solutions.push(async function barelyMeet(context: T, world: World) {
        const comet = await context.getComet();
        for (const assetName in actorsByAsset) {
          const asset = await getAssetFromName(assetName, context)
          for (const actorName in actorsByAsset[assetName]) {
            const actor = context.actors[actorName];
            const amount = actorsByAsset[assetName][actorName];
            const cometBalance = (await comet.collateralBalanceOf(actor.address, asset.address)).toBigInt();
            const decimals = await asset.token.decimals();
            let toTransfer = 0n;
            if (amount.$eq) {
              toTransfer = exp(amount.$eq, decimals) - cometBalance;
            } else if (amount.$gte) {
              toTransfer = exp(amount.$gte, decimals) - cometBalance;
            } else if (amount.$lte) {
              toTransfer = exp(amount.$lte, decimals) - cometBalance;
            } else if (amount.$gt) {
              toTransfer = exp(amount.$gt, decimals) - cometBalance + 1n;
            } else if (amount.$lt) {
              toTransfer = exp(amount.$lt, decimals) - cometBalance - 1n;
            } else {
              throw new Error(`Bad amount: ${amount}`);
            }
            if (toTransfer > 0) {
              // Case: Supply asset
              // 1. Source tokens to user
              await context.sourceTokens(world, toTransfer, asset.address, actor.address);
              console.log('sourced tokens')
              // 2. Supply tokens to Comet
              // Note: but will interest rates cause supply/borrow to not exactly match the desired amount?
              await asset.approve(actor, comet.address);
              await actor.supplyAsset({asset: asset.address, amount: toTransfer})
              console.log('supplied asset amount: ', toTransfer)
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
                  console.log('making up for base shortfall')
                  await context.sourceTokens(world, cometBaseBalanceShortfall, baseToken.address, comet.address);
                }
                // 3. Borrow base (will supply collateral if needed to borrow)
                await borrowBase(actor, -toTransfer, world, context);
              } else {
                // Case: Withdraw collateral asset
                // 1. Withdraw collateral
                await actor.withdrawAsset({ asset: asset.address, amount: toWithdraw });
                console.log('withdrew collat')
              }
            }
          }
        }
        return context;
      });
      return solutions;
    }
  }

  async check(requirements: R, context: T, world: World) {
    const assetsByActor = requirements.cometBalances;
    const comet = await context.getComet();
    if (assetsByActor) {
      for (const [actorName, assets] of Object.entries(assetsByActor)) {
        for (const [assetName, rawAmount] of Object.entries(assets)) {
          const actor = context.actors[actorName];
          const asset = await getAssetFromName(assetName, context)
          const amount = parseAmount(rawAmount);
          const decimals = await asset.token.decimals();
          const baseToken = await comet.baseToken();
          let balance;
          if (asset.address === baseToken) {
            balance = await comet.baseBalanceOf(actor.address);
          } else {
            balance = await comet.collateralBalanceOf(actor.address, asset.address);
          }
          if (amount.$eq) {
            expect(balance).to.equal(exp(amount.$eq, decimals));
          } else if (amount.$gte) {
            expect(balance).to.be.at.least(exp(amount.$gte, decimals));
          } else if (amount.$lte) {
            expect(balance).to.be.at.most(exp(amount.$lte, decimals));
          } else if (amount.$gt) {
            expect(balance).to.be.above(exp(amount.$gt, decimals));
          } else if (amount.$lt) {
            expect(balance).to.be.below(exp(amount.$lt, decimals));
          }
        }
      }
    }
  }
}