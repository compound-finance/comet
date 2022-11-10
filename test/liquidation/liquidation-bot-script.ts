import { expect, exp } from '../helpers';
import { arbitragePurchaseableCollateral, getAssets, hasPurchaseableCollateral, liquidateUnderwaterBorrowers } from '../../scripts/liquidation_bot/liquidateUnderwaterBorrowers';
import { forkMainnet, makeProtocol, makeLiquidatableProtocol, resetHardhatNetwork } from './makeLiquidatableProtocol';

describe('Liquidation Bot', function () {
  before(forkMainnet);
  after(resetHardhatNetwork);

  describe('liquidateUnderwaterBorrowers', function () {
    it('liquidates underwater borrowers', async function () {
      const {
        comet,
        liquidator,
        users: [signer, underwater],
        assets: { dai, usdc },
        whales: { usdcWhale }
      } = await makeLiquidatableProtocol();

      // transfer USDC to comet, so it has money to pay out withdraw to underwater user
      await usdc.connect(usdcWhale).transfer(comet.address, 300000000n); // 300e6
      await dai.connect(underwater).approve(comet.address, 120000000000000000000n);
      await comet.connect(underwater).supply(dai.address, 120000000000000000000n);
      // withdraw to ensure that there is a Withdraw event for the user
      await comet.connect(underwater).withdraw(usdc.address, 10e6);
      // put the position underwater
      await comet.setBasePrincipal(underwater.address, -(exp(200, 6)));

      expect(await comet.isLiquidatable(underwater.address)).to.be.true;

      await liquidateUnderwaterBorrowers(
        comet,
        liquidator,
        {signer}
      );

      expect(await comet.isLiquidatable(underwater.address)).to.be.false;

      const assetAddresses = await getAssets(comet);
      expect(await hasPurchaseableCollateral(comet, assetAddresses, 1)).to.be.false;
    });
  });

  describe('arbitragePurchaseableCollateral', function () {
    it('buys collateral when available', async function () {
      const {
        comet,
        liquidator,
        users: [signer],
        assets: { weth },
        whales: { wethWhale }
      } = await makeProtocol();
      const assetAddresses = await getAssets(comet);

      expect(await hasPurchaseableCollateral(comet, assetAddresses)).to.be.false;

      // Transfer WETH to comet, so it has purchaseable collateral
      await weth.connect(wethWhale).transfer(comet.address, 100000000000000000000n); // 100e18

      expect(await hasPurchaseableCollateral(comet, assetAddresses, 0)).to.be.true;

      await arbitragePurchaseableCollateral(
        comet,
        liquidator,
        assetAddresses,
        {signer}
      );

      // There will be some dust to purchase, but we expect it to be less than $1 of worth
      expect(await hasPurchaseableCollateral(comet, assetAddresses, 1)).to.be.false;
    });

    it('buys all collateral when available', async function () {
      const {
        comet,
        liquidator,
        users: [signer],
        assets: { weth, wbtc, comp, uni, link },
        whales: { wethWhale, wbtcWhale, compWhale, uniWhale, linkWhale }
      } = await makeProtocol();
      const assetAddresses = await getAssets(comet);

      expect(await hasPurchaseableCollateral(comet, assetAddresses)).to.be.false;

      await weth.connect(wethWhale).transfer(comet.address, 100000000000000000000n); // 100e18
      await wbtc.connect(wbtcWhale).transfer(comet.address, 100000000n); // 1e8
      await comp.connect(compWhale).transfer(comet.address, 50000000000000000000n); // 50e18
      await uni.connect(uniWhale).transfer(comet.address, 1000000000000000000000n); // 1000e18
      await link.connect(linkWhale).transfer(comet.address, 5000000000000000000n); // 5e18

      expect(await hasPurchaseableCollateral(comet, assetAddresses, 0)).to.be.true;

      await arbitragePurchaseableCollateral(
        comet,
        liquidator,
        assetAddresses,
        {signer}
      );

      // There will be some dust to purchase, but we expect it to be less than $1 of worth
      expect(await hasPurchaseableCollateral(comet, assetAddresses, 1)).to.be.false;
    });

    it('hasPurchaseableCollateral ignores dust collateral', async function () {
      const {
        comet,
        assets: { weth },
        whales: { wethWhale }
      } = await makeProtocol();
      const assetAddresses = await getAssets(comet);

      expect(await hasPurchaseableCollateral(comet, assetAddresses)).to.be.false;

      // Transfer dust amount of WETH to comet, so it has purchaseable collateral
      await weth.connect(wethWhale).transfer(comet.address, 1000n);

      // Expect non-zero collateral
      expect(await hasPurchaseableCollateral(comet, assetAddresses, 0)).to.be.true;
      // There will be some dust to purchase, but we expect it to be less than $1 of worth
      expect(await hasPurchaseableCollateral(comet, assetAddresses, 1)).to.be.false;
    });
  });
});