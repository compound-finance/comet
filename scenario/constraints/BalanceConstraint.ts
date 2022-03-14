import { Constraint, Scenario, Solution, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { expect } from 'chai';
import { Requirements } from './Requirements';
import { BigNumber } from 'ethers';
import CometAsset from '../context/CometAsset';

function matchGroup(str, patterns) {
  for (const k in patterns) {
    const match = patterns[k].exec(str);
    if (match) return { [k]: BigNumber.from(match[1]) };
  }
  throw new Error(`No match for ${str} in ${patterns}`);
}

function parseAmount(amount) {
  switch (typeof amount) {
    case 'bigint':
    case 'number':
      return { $gte: BigNumber.from(amount) };
    case 'string':
      return matchGroup(amount, {
        $gte: />=\s*(\d+)/,
        $gt: />\s*(\d+)/,
        $lte: /<=\s*(\d+)/,
        $lt: /<\s*(\d+)/,
        $eq: /==\s*(\d+)/,
      });
    case 'object':
      return amount;
    default:
      throw new Error(`Unrecognized amount: ${amount}`);
  }
}

async function getAssetFromName(name: string, context: CometContext): Promise<CometAsset> {
  // XXX add another regex for baseAsset as well
  const collateralAssetRegex = /asset[0-9]+/;
  let comet = await context.getComet(); // TODO: can optimize by taking this as an arg instead
  if (collateralAssetRegex.test(name)) {
    // If name matches regex, e.g. "asset10"
    let { asset: collateralAsset } = await comet.getAssetInfo(0);
    return context.getAssetByAddress(collateralAsset);
  } else {
    // If name doesn't match regex, try to find the asset directly from the assets list
    return context.assets[name];
  }
}

export class BalanceConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, initialContext: T, initialWorld: World) {
    const assetsByActor = requirements.balances;
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
        for (const assetName in actorsByAsset) {
          const asset = await getAssetFromName(assetName, context)
          for (const actorName in actorsByAsset[assetName]) {
            const actor = context.actors[actorName];
            const amount = actorsByAsset[assetName][actorName];
            const balance = await asset.balanceOf(actor.address);
            const assetScale = BigNumber.from(10).pow(BigNumber.from(await asset.token.decimals()));
            let toTransfer = 0n;
            if (amount.$eq) {
              toTransfer = amount.$eq.mul(assetScale).toBigInt() - balance;
            } else if (amount.$gte) {
              toTransfer = amount.$gte.mul(assetScale).toBigInt() - balance;
            } else if (amount.$lte) {
              toTransfer = amount.$lte.mul(assetScale.toBigInt()) - balance;
            } else if (amount.$gt) {
              toTransfer = amount.$gt.mul(assetScale).toBigInt() - balance + 1n;
            } else if (amount.$lt) {
              toTransfer = amount.$lt.mul(assetScale).toBigInt() - balance - 1n;
            } else {
              throw new Error(`Bad amount: ${amount}`);
            }
            await context.sourceTokens(world, toTransfer, asset.address, actor.address);
          }
        }
        return context;
      });
      return solutions;
    }
  }

  async check(requirements: R, context: T, world: World) {
    const assetsByActor = requirements['balances'];
    if (assetsByActor) {
      for (const [actorName, assets] of Object.entries(assetsByActor)) {
        for (const [assetName, rawAmount] of Object.entries(assets)) {
          const actor = context.actors[actorName];
          const asset = await getAssetFromName(assetName, context)
          const amount = parseAmount(rawAmount);
          const balance = BigNumber.from(await asset.balanceOf(actor.address));
          const assetScale = BigNumber.from(10).pow(BigNumber.from(await asset.token.decimals()));
          if (amount.$eq) {
            expect(balance).to.equal(amount.$eq.mul(assetScale).toBigInt());
          } else if (amount.$gte) {
            expect(balance).to.be.at.least(amount.$gte.mul(assetScale).toBigInt());
          } else if (amount.$lte) {
            expect(balance).to.be.at.most(amount.$lte.mul(assetScale).toBigInt());
          } else if (amount.$gt) {
            expect(balance).to.be.above(amount.$gt.mul(assetScale).toBigInt());
          } else if (amount.$lt) {
            expect(balance).to.be.below(amount.$lt.mul(assetScale).toBigInt());
          }
        }
      }
    }
  }
}