import { Constraint, Scenario, Solution, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { deployComet } from '../../src/deploy';
import { optionalNumber } from './utils';
import { defactor, exp, factor, factorScale, ZERO } from '../../test/helpers';
import { expect } from 'chai';

/**
  # Utilization Constraint

  This constraint is used to constrain the utilization rate, by adjust the total
  supply and/or borrows of Comet.

  ## Configuration

  **requirements**: `{ utilization: number }`

  If passed in, the constraint will ensure that the utilization of the protocol
  is exactly the given value. If this constraint cannot be fulfilled, we will
  throw an error, rather than return "no solutions."

  * Example: `{ utilization: 0.5 }` to target 50% utilization (borrows / supply).
  * Note: if utilization is passed as 0, this will target either borrows=0 or supply=0
**/

interface UtilizationConfig {
  utilization?: number;
}

function getUtilizationConfig(requirements: object): UtilizationConfig | null {
  return {
    utilization: optionalNumber(requirements, 'utilization'),
  };
}

function floor(n: number): bigint {
  return BigInt(Math.floor(n));
}

/*
some math notes:

let utilization = borrows / supply

check if (utilization < target):
  *> (borrows + X) / supply = target
  -> (borrows + X) = target * supply
  -> X = target * supply - borrows
else
  *> borrows / (supply+X) = target
  -> borrows = target * (supply+X)
  -> borrows / target = (supply+X)
  -> ( borrows / target ) - supply = X
*/
export class UtilizationConstraint<T extends CometContext> implements Constraint<T> {
  async solve(requirements: object, context: T, world: World) {
    let { utilization } = getUtilizationConfig(requirements);

    if (!utilization) {
      return null;
    } else {
      // utilization is target number
      return async ({ comet }: T): Promise<T> => {
        let baseToken = context.getAssetByAddress(await comet.baseToken());
        let utilizationFactor = factor(utilization);
        let { totalSupplyBase: totalSupplyBaseBN, totalBorrowBase: totalBorrowBaseBN } =
          await comet.totalsBasic();
        let totalSupplyBase = totalSupplyBaseBN.toBigInt();
        let totalBorrowBase = totalBorrowBaseBN.toBigInt();

        let toBorrowBase: bigint = 0n;
        let toSupplyBase: bigint = 0n;

        // TODO: Handle units for precision, etc
        if (totalSupplyBase == 0n) {
          toSupplyBase = 10n * (await comet.baseScale()).toBigInt(); // Have at least 10 base units
        }

        let expectedSupplyBase = totalSupplyBase + toSupplyBase;
        let currentUtilization = totalBorrowBase / expectedSupplyBase;

        if (currentUtilization < utilizationFactor) {
          toBorrowBase =
            toBorrowBase + floor(utilization * Number(expectedSupplyBase)) - totalBorrowBase;
        } else {
          toSupplyBase =
            toSupplyBase + floor(Number(totalBorrowBase) / utilization) - expectedSupplyBase;
        }

        // It's really hard to target a utilization if we don't have _any_ base token supply, since
        // everything will come out as zero.
        if (toSupplyBase > 0n) {
          // Add some supply, any amount will do
          let supplyActor = await context.allocateActor(world, 'UtilizationConstraint{Supplier}', {
            toSupplyBase,
          });

          await baseToken.approve(supplyActor, comet);
          await context.sourceTokens(world, toSupplyBase, baseToken, supplyActor);
          await comet.connect(supplyActor.signer).supply(baseToken.address, toSupplyBase);
        }

        if (toBorrowBase > 0n) {
          // To borrow as much, we need to supply some collateral. We technically
          // could provide a solution for each token, but we don't know them in advance,
          // generally, so let's just pick the first one and source enough of it.

          let { asset: collateralAsset, borrowCollateralFactor, priceFeed, scale } = await comet.getAssetInfo(0);

          let collateralToken = context.getAssetByAddress(collateralAsset);

          let basePrice = (await comet.getPrice(await comet.baseTokenPriceFeed())).toBigInt();
          let collateralPrice = (await comet.getPrice(priceFeed)).toBigInt();

          let baseScale = (await comet.baseScale()).toBigInt();
          let collateralScale = scale.toBigInt();

          let collateralWeiPerUnitBase = (collateralScale * basePrice) / collateralPrice;
          let collateralNeeded = (collateralWeiPerUnitBase * toBorrowBase) / baseScale;
          collateralNeeded = (collateralNeeded * factorScale) / borrowCollateralFactor.toBigInt(); // adjust for borrowCollateralFactor
          collateralNeeded = (collateralNeeded * 11n) / 10n; // add fudge factor

          let info = {
            utilization,
            totalSupplyBase: totalSupplyBase.toString(),
            totalBorrowBase: totalBorrowBase.toString(),
            toBorrowBase: toBorrowBase.toString(),
            collateralAsset,
            borrowCollateralFactor: borrowCollateralFactor.toString(),
            collateralNeeded: collateralNeeded.toString(),
          };

          let borrowActor = await context.allocateActor(
            world,
            'UtilizationConstraint{Borrower}',
            info
          );

          await context.sourceTokens(world, collateralNeeded, collateralToken, borrowActor);
          await collateralToken.approve(borrowActor, comet);
          await comet.connect(borrowActor.signer).supply(collateralToken.address, collateralNeeded);
          await comet.connect(borrowActor.signer).withdraw(baseToken.address, toBorrowBase);
        }

        return context;
      };
    }
  }

  async check(requirements: object, { comet }: T, world: World) {
    let { utilization } = getUtilizationConfig(requirements);

    if (utilization) {
      expect(defactor(await comet.getUtilization())).to.approximately(0.5, 0.000001);
    }
  }
}
