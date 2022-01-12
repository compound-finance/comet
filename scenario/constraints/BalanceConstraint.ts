import { Constraint, Scenario, Solution, World } from '../../plugins/scenario';
import { sourceTokens } from '../../plugins/scenario/utils/TokenSourcer';
import { CometContext } from '../context/CometContext';

import { expect } from 'chai';

function matchGroup(str, patterns) {
  for (const k in patterns) {
    const match = patterns[k].exec(str);
    if (match) return { [k]: match[1] };
  }
  throw new Error(`No match for ${str} in ${patterns}`);
}

function parseAmount(amount) {
  switch (typeof amount) {
    case 'bigint':
    case 'number':
      return { $gte: amount };
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

export class BalanceConstraint<T extends CometContext> implements Constraint<T> {
  async solve(requirements: object, context: T, world: World) {
    const assetsByActor = requirements['balances'];
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
      solutions.push(async function barelyMeet(ctx: T, world: World) {
        for (const assetName in actorsByAsset) {
          const asset = context.assets[assetName];
          for (const actorName in actorsByAsset[assetName]) {
            const actor = context.actors[actorName];
            const amount = actorsByAsset[assetName][actorName];
            const balance = await asset.balanceOf(actor.address);
            let toTransfer = 0n;
            if (amount.$eq) {
              toTransfer = amount.$eq - balance;
            } else if (amount.$gte) {
              toTransfer = amount.$gte - balance;
            } else if (amount.$lte) {
              toTransfer = amount.$lte - balance;
            } else if (amount.$gt) {
              toTransfer = amount.$gt - balance + 1n;
            } else if (amount.$lt) {
              toTransfer = amount.$lt - balance - 1n;
            } else {
              throw new Error(`Bad amount: ${amount}`);
            }
            await sourceTokens({
              hre: world.hre,
              amount: toTransfer,
              asset: asset.address,
              address: actor.address,
            });
          }
        }
        return context;
      });
      return solutions;
    }
  }

  async check(requirements: object, context: T, world: World) {
    const assetsByActor = requirements['balances'];
    if (assetsByActor) {
      for (const [actorName, assets] of Object.entries(assetsByActor)) {
        for (const [assetName, rawAmount] of Object.entries(assets)) {
          const actor = context.actors[actorName];
          const asset = context.assets[assetName];
          const amount = parseAmount(rawAmount);
          const balance = await asset.balanceOf(actor.address);
          if (amount.$eq) {
            expect(balance).to.equal(amount.$eq);
          } else if (amount.$gte) {
            expect(balance).to.be.at.least(amount.$gte);
          } else if (amount.$lte) {
            expect(balance).to.be.at.most(amount.$lte);
          } else if (amount.$gt) {
            expect(balance).to.be.above(amount.$gt);
          } else if (amount.$lt) {
            expect(balance).to.be.below(amount.$lt);
          }
        }
      }
    }
  }
}
