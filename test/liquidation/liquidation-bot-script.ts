import { expect, exp } from '../helpers';
import { arbitragePurchaseableCollateral, getAssets, hasPurchaseableCollateral, liquidateUnderwaterBorrowers } from '../../scripts/liquidation_bot/liquidateUnderwaterBorrowers';
import { forkMainnet, makeProtocol, makeLiquidatableProtocol, resetHardhatNetwork } from './makeLiquidatableProtocol';

describe('Liquidation Bot', function () {
  before(forkMainnet);
  after(resetHardhatNetwork);

  describe('liquidateUnderwaterBorrowers', function () {
    const assetAmounts = {
      'comp': exp(120, 18),
      'link': exp(200, 18), // XXX small amount; increase transfer to user
      'uni': exp(200, 18), // XXX small amount; increase transfer to user
      'wbtc': exp(1, 8),
      'weth': exp(200, 18)
    };

    for (const k in assetAmounts) {
      it(`liquidates an underwater borrower of ${k}`, async function() {
        const {
          comet,
          liquidator,
          users: [signer, underwater],
          assets,
          whales: { usdcWhale }
        } = await makeLiquidatableProtocol();

        const { usdc } = assets;
        const asset = assets[k];
        const supplyAmount = assetAmounts[k];

        // transfer USDC to comet, so it has money to pay out withdraw to underwater user
        await usdc.connect(usdcWhale).transfer(comet.address, exp(300, 6));
        await asset.connect(underwater).approve(comet.address, supplyAmount);
        await comet.connect(underwater).supply(asset.address, supplyAmount);
        // withdraw to ensure that there is a Withdraw event for the user
        await comet.connect(underwater).withdraw(usdc.address, 10e6);
        // put the position underwater
        await comet.setBasePrincipal(underwater.address, -(exp(20000, 6)));

        expect(await comet.isLiquidatable(underwater.address)).to.be.true;

        await liquidateUnderwaterBorrowers(
          comet,
          liquidator,
          { signer },
          'mainnet',
          'usdc'
        );

        expect(await comet.isLiquidatable(underwater.address)).to.be.false;

        const assetAddresses = await getAssets(comet);
        expect(await hasPurchaseableCollateral(comet, assetAddresses, 1e6)).to.be.false;
        // make sure that hasPurchaseableCollateral is false not because the
        // protocol has exceeded target reserves
        expect(
          (await comet.getReserves()).lt(await comet.targetReserves())
        ).to.be.true;
      });
    }
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

      expect(await hasPurchaseableCollateral(comet, assetAddresses, 10e6)).to.be.false;

      // Transfer WETH to comet, so it has purchaseable collateral
      await weth.connect(wethWhale).transfer(comet.address, 100000000000000000000n); // 100e18

      expect(await hasPurchaseableCollateral(comet, assetAddresses, 0)).to.be.true;

      await arbitragePurchaseableCollateral(
        comet,
        liquidator,
        assetAddresses,
        {signer},
        'mainnet',
        'usdc'
      );

      // There will be some dust to purchase, but we expect it to be less than $1 of worth
      expect(await hasPurchaseableCollateral(comet, assetAddresses, 1e6)).to.be.false;
      // make sure that hasPurchaseableCollateral is false not because the
      // protocol has exceeded target reserves
      expect(
        (await comet.getReserves()).lt(await comet.targetReserves())
      ).to.be.true;
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

      expect(await hasPurchaseableCollateral(comet, assetAddresses, 10e6)).to.be.false;

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
        {signer},
        'mainnet',
        'usdc'
      );

      // There will be some dust to purchase, but we expect it to be less than $1 of worth
      expect(await hasPurchaseableCollateral(comet, assetAddresses, 1e6)).to.be.false;
      // make sure that hasPurchaseableCollateral is false not because the
      // protocol has exceeded target reserves
      expect(
        (await comet.getReserves()).lt(await comet.targetReserves())
      ).to.be.true;
    });

    it('hasPurchaseableCollateral ignores dust collateral', async function () {
      const {
        comet,
        assets: { weth },
        whales: { wethWhale }
      } = await makeProtocol();
      const assetAddresses = await getAssets(comet);

      expect(await hasPurchaseableCollateral(comet, assetAddresses, 10e6)).to.be.false;

      // Transfer dust amount of WETH to comet, so it has purchaseable collateral
      await weth.connect(wethWhale).transfer(comet.address, 1000n);

      // Expect non-zero collateral
      expect(await hasPurchaseableCollateral(comet, assetAddresses, 0)).to.be.true;
      // There will be some dust to purchase, but we expect it to be less than $1 of worth
      expect(await hasPurchaseableCollateral(comet, assetAddresses, 1e6)).to.be.false;
      // make sure that hasPurchaseableCollateral is false not because the
      // protocol has exceeded target reserves
      expect(
        (await comet.getReserves()).lt(await comet.targetReserves())
      ).to.be.true;
    });

    // XXX hasPurchaseableCollateral returns false when reserves are above target reserves
  });
});
