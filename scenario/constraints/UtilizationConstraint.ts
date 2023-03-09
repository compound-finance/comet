import { Constraint } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { optionalNumber } from '../utils';
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

function getUtilizationConfig(requirements: object): UtilizationConfig {
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
  async solve(requirements: R, _context: T) {
    let { utilization } = getUtilizationConfig(requirements);

    if (utilization === undefined) {
      return null;
    } else {
      // utilization is target number
      return async (context: T): Promise<T> => {
        let comet = await context.getComet();

        let baseToken = context.getAssetByAddress(await comet.baseToken());
        let utilizationFactor = factor(utilization!);
        let totalSupplyBase = (await comet.totalSupply()).toBigInt();
        let totalBorrowBase = (await comet.totalBorrow()).toBigInt();

        // always have at least enough supply to cover current borrows
        let toBorrowBase = 0n;
        let toSupplyBase = totalBorrowBase <= totalSupplyBase ? 10n : totalBorrowBase - totalSupplyBase;

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
          let supplyActor = await context.allocateActor('UtilizationConstraint{Supplier}');

          await baseToken.approve(supplyActor, comet);
          await context.sourceTokens(toSupplyBase, baseToken, supplyActor);
          await comet.connect(supplyActor.signer).supply(baseToken.address, toSupplyBase);
        }

        if (toBorrowBase > 0n) {
          const borrowActor = await context.allocateActor('UtilizationConstraint{Borrower}');

          // To borrow as much, we need to supply some collateral.
          const numAssets = await comet.numAssets();
          for (let i = 0; i < numAssets; i++) {
            console.log(`UtilizationConstraint: attempting to source from $asset${i}`);

            const { asset: collateralAsset, borrowCollateralFactor, priceFeed, scale } = await comet.getAssetInfo(i);

            const collateralToken = context.getAssetByAddress(collateralAsset);

            const basePrice = (await comet.getPrice(await comet.baseTokenPriceFeed())).toBigInt();
            const collateralPrice = (await comet.getPrice(priceFeed)).toBigInt();

            const baseScale = (await comet.baseScale()).toBigInt();
            const collateralScale = scale.toBigInt();

            const collateralWeiPerUnitBase = (collateralScale * basePrice) / collateralPrice;
            let collateralNeeded = (collateralWeiPerUnitBase * toBorrowBase) / baseScale;
            collateralNeeded = (collateralNeeded * factorScale) / borrowCollateralFactor.toBigInt(); // adjust for borrowCollateralFactor
            collateralNeeded = (collateralNeeded * 11n) / 10n; // add fudge factor

            try {
              await context.sourceTokens(collateralNeeded, collateralToken, borrowActor);
              await collateralToken.approve(borrowActor, comet);
              await borrowActor.safeSupplyAsset({ asset: collateralToken.address, amount: collateralNeeded });
              console.log(`UtilizationConstraint: successfully sourced ${collateralNeeded} from $asset${i}`);
            } catch (error) {
              console.log(`UtilizationConstraint: failed to source ${collateralNeeded} from $asset${i} (${error.message.slice(0, 512)}...)`);
            }
          }

          // XXX how to make sure there are enough base tokens in the protocol to withdraw?
          console.log(`UtilizationConstraint: attempting to borrow ${toBorrowBase} base`);
          await comet.connect(borrowActor.signer).withdraw(baseToken.address, toBorrowBase);
        }

        return context;
      };
    }
  }

  async check(requirements: R, context: T) {
    let { utilization } = getUtilizationConfig(requirements);

    if (utilization) {
      let comet = await context.getComet();
      expect(defactor(await comet.getUtilization())).to.approximately(utilization, 0.00001);
    }
  }
}
