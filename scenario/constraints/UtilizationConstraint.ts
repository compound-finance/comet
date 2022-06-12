import { Constraint, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { bumpSupplyCaps, optionalNumber } from '../utils';
import { defactor, factor, factorScale } from '../../test/helpers';
import { expect } from 'chai';
import { Requirements } from './Requirements';

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
export class UtilizationConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, context: T, world: World) {
    let { utilization } = getUtilizationConfig(requirements);

    if (utilization == null) {
      return null;
    } else {
      // utilization is target number
      return async (context: T): Promise<T> => {
        let comet = await context.getComet();

        let baseToken = context.getAssetByAddress(await comet.baseToken());
        let utilizationFactor = factor(utilization);
        let totalSupplyBase = (await comet.totalSupply()).toBigInt();
        let totalBorrowBase = (await comet.totalBorrow()).toBigInt();

        let toBorrowBase: bigint = 0n;
        let toSupplyBase: bigint = 0n;

        // TODO: Handle units for precision, etc
        if (totalSupplyBase == 0n) {
          toSupplyBase = 10n * (await comet.baseScale()).toBigInt(); // Have at least 10 base units
        }

        let expectedSupplyBase = totalSupplyBase + toSupplyBase;
        let expectedBorrowBase = utilizationFactor * expectedSupplyBase / factorScale;
        let currentUtilizationFactor = (totalBorrowBase * factorScale) / expectedSupplyBase;

        if (currentUtilizationFactor < utilizationFactor) {
          toBorrowBase = expectedBorrowBase - totalBorrowBase;

          let baseBorrowMin = (await comet.baseBorrowMin()).toBigInt();
          if (toBorrowBase < baseBorrowMin) {
            expectedBorrowBase = expectedBorrowBase + baseBorrowMin - toBorrowBase;
            expectedSupplyBase = expectedBorrowBase * factorScale / utilizationFactor;
            toBorrowBase = baseBorrowMin;
            toSupplyBase = expectedSupplyBase - totalSupplyBase;
          }
        } else {
          if (utilizationFactor === 0n) {
            utilizationFactor = 1n; // to avoid dividing by 0
          }
          toSupplyBase = toSupplyBase + (totalBorrowBase * factorScale / utilizationFactor) - expectedSupplyBase;
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
          await bumpSupplyCaps(world, context, { [collateralToken.address]: collateralNeeded })
          await comet.connect(borrowActor.signer).supply(collateralToken.address, collateralNeeded);

          // XXX will also need to make sure there are enough base tokens in the protocol to withdraw
          await comet.connect(borrowActor.signer).withdraw(baseToken.address, toBorrowBase);
        }

        return context;
      };
    }
  }

  async check(requirements: R, context: T, world: World) {
    let { utilization } = getUtilizationConfig(requirements);

    if (utilization) {
      let comet = await context.getComet();
      expect(defactor(await comet.getUtilization())).to.approximately(utilization, 0.00001);
    }
  }
}
