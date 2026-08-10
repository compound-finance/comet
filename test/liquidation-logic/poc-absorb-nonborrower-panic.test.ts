import { exp, makeProtocol, expect } from '../helpers';

/**
 * F-3 verification (wip-partial) — RESULT: NOT A BUG.
 *
 * F-3 claimed that absorbInternal's
 *
 *     uint256 debtRemainingValue = mulPrice(uint256(-presentValue(accountUser.principal)), basePrice, baseScale);
 *     if (accountUser.principal > 0 || debtRemainingValue <= liquidity) revert NotLiquidatable();
 *
 * would revert with a raw arithmetic Panic (0x11) for a supplier (principal > 0), because
 * `uint256(-presentValue(+))` wraps to ~2^256. In practice this does NOT happen: a non-borrower
 * absorb reverts cleanly with `NotLiquidatable`. These tests pin that correct behaviour.
 *
 * Covered:
 *   - principal  > 0  via a REAL supply() (baseSupplyIndex = 1e15, principal = 1e8) → NotLiquidatable
 *   - principal == 0                                                                 → NotLiquidatable
 */
describe('absorb: non-borrower accounts revert NotLiquidatable (F-3 verification)', function () {
  it('real supplier (principal > 0) reverts NotLiquidatable, not a panic', async () => {
    const { cometWithExtendedAssetList: comet, tokens, users: [absorber, supplier] } = await makeProtocol({ base: 'USDC' });

    const usdc = tokens['USDC'];
    await usdc.allocateTo(supplier.address, exp(100, 6));
    await usdc.connect(supplier).approve(comet.address, exp(100, 6));
    await comet.connect(supplier).supply(usdc.address, exp(100, 6)); // principal becomes +1e8

    await expect(
      comet.absorb(absorber.address, [supplier.address])
    ).to.be.revertedWithCustomError(comet, 'NotLiquidatable');
  });

  it('zero-principal account reverts NotLiquidatable', async () => {
    const { cometWithExtendedAssetList: comet, users: [absorber, idle] } = await makeProtocol();

    await comet.setBasePrincipal(idle.address, 0);

    await expect(
      comet.absorb(absorber.address, [idle.address])
    ).to.be.revertedWithCustomError(comet, 'NotLiquidatable');
  });
});
