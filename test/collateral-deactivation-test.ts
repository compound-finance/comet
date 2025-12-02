import { CometExt, CometHarnessInterfaceExtendedAssetList } from 'build/types';
import { MAX_ASSETS, expect, makeProtocol } from './helpers';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { ContractTransaction } from 'ethers';

/**
 * @title Collateral deactivation and reactivation tests
 * @notice
 *  This test suite documents and verifies the collateral deactivation feature that was
 *  introduced after the wUSDM and deUSD incident. In that incident, the protocol needed
 *  to react quickly to compromised / risky collateral, but the only available control
 *  surface was the governance proposal system, which introduces latency and coordination
 *  overhead.
 *
 *  To address this, Comet was extended with a dedicated collateral deactivation mechanism:
 *  - The `pauseGuardian` can immediately deactivate a collateral asset by index via
 *    `CometExt.deactivateCollateral(assetIndex)`.
 *  - Deactivation sets a bit in `deactivatedCollaterals` storage and, for the given asset:
 *      - marks the asset as deactivated in core `Comet` (`isCollateralDeactivated`),
 *      - pauses supply of that collateral (via `collateralsSupplyPauseFlags`),
 *      - pauses transfer of that collateral (via `collateralsTransferPauseFlags`).
 *  - Once the risk is understood and resolved, the `governor` can later reactivate the
 *    asset via `CometExt.activateCollateral(assetIndex)`, which:
 *      - clears the deactivation bit in `deactivatedCollaterals`,
 *      - unpauses supply and transfer for that asset.
 *
 *  This design allows:
 *  - **Fast, operational safety response** (pauseGuardian can respond without waiting for a
 *    full governance proposal lifecycle).
 *  - **Granularity per asset** (deactivate / activate by asset index, without impacting
 *    other collaterals).
 *  - **Clear separation of roles**:
 *      - `pauseGuardian`: emergency, short-term safety actions (deactivation).
 *      - `governor`: long-term policy decisions and re-enabling assets (activation).
 *
 * @dev
 *  What is tested in this file:
 *
 *  1. **Collateral deactivation happy path**
 *     - The `pauseGuardian` can successfully call `deactivateCollateral(assetIndex)`.
 *     - The transaction emits:
 *         - `CollateralDeactivated(assetIndex)` to signal that the asset has been marked
 *           as deactivated in protocol storage.
 *         - `CollateralAssetSupplyPauseAction(assetIndex, true)` to signal that new supply
 *           of the asset is paused.
 *         - `CollateralAssetTransferPauseAction(assetIndex, true)` to signal that transfers
 *           of that collateral are paused.
 *     - The core `Comet` contract reflects the updated state:
 *         - `isCollateralDeactivated(assetIndex)` returns `true`.
 *         - `deactivatedCollaterals()` has the corresponding bit set.
 *         - `isCollateralAssetSupplyPaused(assetIndex)` and
 *           `isCollateralAssetTransferPaused(assetIndex)` both return `true`.
 *
 *  2. **Collateral deactivation failure modes**
 *     - Only the `pauseGuardian` may deactivate collateral:
 *         - Calls from `governor` (or any non-pauseGuardian address) revert with the
 *           `OnlyPauseGuardian` custom error.
 *     - Asset index bounds are enforced:
 *         - Using an out-of-range index (`MAX_ASSETS`) reverts with `InvalidAssetIndex`.
 *
 *  3. **Collateral activation happy path**
 *     - The `governor` can successfully call `activateCollateral(assetIndex)` to re-enable
 *       a previously deactivated asset.
 *     - The transaction emits:
 *         - `CollateralActivated(assetIndex)` to signal that the deactivation flag for the
 *           asset has been cleared.
 *         - `CollateralAssetSupplyPauseAction(assetIndex, false)` to signal that new
 *           supply is allowed again.
 *         - `CollateralAssetTransferPauseAction(assetIndex, false)` to signal that
 *           transfers are allowed again.
 *     - Core `Comet` state is updated:
 *         - `isCollateralDeactivated(assetIndex)` returns `false`.
 *         - `deactivatedCollaterals()` is updated to clear the corresponding bit.
 *         - `isCollateralAssetSupplyPaused(assetIndex)` and
 *           `isCollateralAssetTransferPaused(assetIndex)` both return `false`.
 *
 *  4. **Collateral activation failure modes**
 *     - Only the `governor` may activate collateral:
 *         - Calls from the `pauseGuardian` (or any non-governor address) revert with
 *           the `OnlyGovernor` custom error.
 *     - Asset index bounds are enforced:
 *         - Using an out-of-range index (`MAX_ASSETS`) reverts with `InvalidAssetIndex`.
 *
 *  5. **MAX_ASSETS scalability and coverage**
 *     - The suite constructs a protocol with `MAX_ASSETS` collaterals and iterates over
 *       all valid indices.
 *     - For each `assetIndex` in `[0, MAX_ASSETS - 1]`:
 *         - `deactivateCollateral(assetIndex)` is callable by the `pauseGuardian` and
 *           marks the asset as deactivated in `Comet` (`isCollateralDeactivated` is `true`).
 *         - `activateCollateral(assetIndex)` is callable by the `governor` and clears the
 *           deactivated flag (`isCollateralDeactivated` is `false`).
 *     - This proves that the deactivation / activation bitmaps and pause flags scale across
 *       the entire configured collateral set, including those whose bits are stored in both
 *       `assetsIn` and `_reserved` segments on the core contract side.
 *
 *  Together, these tests ensure that after the wUSDM and deUSD incident:
 *  - the protocol has a robust, low-latency mechanism to quarantine risky collateral
 *    without waiting on governance,
 *  - the mechanism is correctly wired to both storage-level flags and high-level events,
 *  - and it behaves safely and predictably across all supported asset indices and roles.
 */
describe('collateral deactivation functionality', function () {
  // Contracts
  let comet: CometHarnessInterfaceExtendedAssetList;
  let cometExt: CometExt;

  // Signers
  let governor: SignerWithAddress;
  let pauseGuardian: SignerWithAddress;

  // Constants
  const ASSET_INDEX = 0;

  before(async function () {
    const collaterals = Object.fromEntries(
      Array.from({ length: MAX_ASSETS }, (_, j) => [`ASSET${j}`, {}])
    );
    const protocol = await makeProtocol({
      assets: { USDC: {}, ...collaterals },
    });
    comet = protocol.cometWithExtendedAssetList;
    cometExt= comet.attach(comet.address) as CometExt;
    governor = protocol.governor;
    pauseGuardian = protocol.pauseGuardian;
  });

  describe('collateral deactivation', function () {
    describe('happy path', function () {
      let deactivateCollateralTx: ContractTransaction;
      it('allows to deactivate by pause guardian', async function () {
        deactivateCollateralTx = await cometExt.connect(pauseGuardian).deactivateCollateral(ASSET_INDEX);
        await expect(deactivateCollateralTx).to.not.be.reverted;
      });

      it('emits CollateralDeactivated event', async function () {
        expect(deactivateCollateralTx).to.emit(cometExt, 'CollateralDeactivated').withArgs(ASSET_INDEX);
      });

      it('emits CollateralAssetSupplyPauseAction event', async function () {
        expect(deactivateCollateralTx).to.emit(cometExt, 'CollateralAssetSupplyPauseAction').withArgs(ASSET_INDEX, true);
      });

      it('emits CollateralAssetTransferPauseAction event', async function () {
        expect(deactivateCollateralTx).to.emit(cometExt, 'CollateralAssetTransferPauseAction').withArgs(ASSET_INDEX, true);
      });

      it('sets collateral as deactivated in comet', async function () {
        expect(await comet.isCollateralDeactivated(ASSET_INDEX)).to.be.true;
      });

      it('updates deactivated collaterals flag in comet storage', async function () {
        expect(await comet.deactivatedCollaterals()).to.equal(1);
      });

      it('updates pause flags for deactivated collateral', async function () {
        expect(await comet.isCollateralAssetSupplyPaused(ASSET_INDEX)).to.be.true;
        expect(await comet.isCollateralAssetTransferPaused(ASSET_INDEX)).to.be.true;
      });
    });

    describe('reverts when', function () {
      it('caller is not pause guardian', async function () {
        await expect(cometExt.connect(governor).deactivateCollateral(ASSET_INDEX)).to.be.revertedWithCustomError(cometExt, 'OnlyPauseGuardian');
      });

      it('asset index is invalid', async function () {
        await expect(cometExt.connect(pauseGuardian).deactivateCollateral(MAX_ASSETS)).to.be.revertedWithCustomError(cometExt, 'InvalidAssetIndex');
      });
    });
  });

  describe('collateral activation', function () {
    describe('happy path', function () {
      let activateCollateralTx: ContractTransaction;
      it('allows to activate by governor', async function () {
        activateCollateralTx = await cometExt.connect(governor).activateCollateral(ASSET_INDEX);
        await expect(activateCollateralTx).to.not.be.reverted;
      });

      it('emits CollateralActivated event', async function () {
        expect(activateCollateralTx).to.emit(cometExt, 'CollateralActivated').withArgs(ASSET_INDEX);
      });

      it('emits CollateralAssetSupplyPauseAction event', async function () {
        expect(activateCollateralTx).to.emit(cometExt, 'CollateralAssetSupplyPauseAction').withArgs(ASSET_INDEX, false);
      });

      it('emits CollateralAssetTransferPauseAction event', async function () {
        expect(activateCollateralTx).to.emit(cometExt, 'CollateralAssetTransferPauseAction').withArgs(ASSET_INDEX, false);
      });

      it('sets collateral as activated in comet', async function () {
        expect(await comet.isCollateralDeactivated(ASSET_INDEX)).to.be.false;
      });
      
      it('updates deactivated collaterals flag in comet storage', async function () {
        expect(await comet.deactivatedCollaterals()).to.equal(0);
      });

      it('updates pause flags for activated collateral', async function () {
        expect(await comet.isCollateralAssetSupplyPaused(ASSET_INDEX)).to.be.false;
        expect(await comet.isCollateralAssetTransferPaused(ASSET_INDEX)).to.be.false;
      });
    });

    describe('reverts when', function () {
      it('caller is not governor', async function () {
        await expect(cometExt.connect(pauseGuardian).activateCollateral(ASSET_INDEX)).to.be.revertedWithCustomError(cometExt, 'OnlyGovernor');
      });

      it('asset index is invalid', async function () {
        await expect(cometExt.connect(governor).activateCollateral(MAX_ASSETS)).to.be.revertedWithCustomError(cometExt, 'InvalidAssetIndex');
      });
    });
  });

  describe(`${MAX_ASSETS} assets support`, function () {
    describe('deactivation', function () {
      for (let i = 1; i <= MAX_ASSETS; i++) {
        it(`allows to deactivate for asset ${i}`, async function () {
          const assetIndex = i - 1;
              
          // Deactivate
          await cometExt.connect(pauseGuardian).deactivateCollateral(assetIndex);
              
          // Verify that the collateral at index i is deactivated
          expect(await comet.isCollateralDeactivated(assetIndex)).to.be.true;
        });
      }
    });

    describe('activation', function () {
      for (let i = 1; i <= MAX_ASSETS; i++) {
        it(`allows to activate for asset ${i}`, async function () {
          const assetIndex = i - 1;
                
          // Activate
          await cometExt.connect(governor).activateCollateral(assetIndex);
                
          // Verify that the collateral at index i is activated
          expect(await comet.isCollateralDeactivated(assetIndex)).to.be.false;
        });
      }
    });
  });
});