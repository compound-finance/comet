import { expect } from 'chai';
import { CometContext, scenario } from './context/CometContext';
import { MAX_ASSETS, isAssetDelisted, isValidAssetIndex, usesAssetList, supportsExtendedPause } from './utils';

/**
 * @title Quote Collateral Scenario
 * @notice Test suite for quoteCollateral behavior with and without liquidation discounts
 *
 * @dev This test suite was written after the USDM incident, when a token price feed was removed from Chainlink.
 * The incident revealed that when a price feed becomes unavailable, the protocol cannot calculate the USD value
 * of collateral (e.g., during absorption when trying to getPrice() for a delisted asset).
 *
 * @dev The solution was to set the asset's liquidationFactor to 0 for delisted collateral. For quoteCollateral,
 * when liquidationFactor = 0, the store front discount becomes 0, and quoteCollateral quotes at market price
 * without any discount (see quoteCollateral() in CometWithExtendedAssetList.sol)
 *
 * @dev This scenario tests quoteCollateral behavior in two phases:
 * 1. Normal operation: Verifies that quoteCollateral applies the correct discount when liquidationFactor > 0
 * 2. Delisted asset: Sets liquidationFactor to 0 and verifies that quoteCollateral quotes at market price
 *    without discount, handling the transition correctly
 *
 * @dev The scenario runs for all valid assets (up to MAX_ASSETS) and only on Comet deployments that use
 * the extended asset list feature (CometExtAssetList), as the quoteCollateral behavior with liquidationFactor = 0
 * is specific to that implementation. The test filters deployments using the usesAssetList() utility function
 * to ensure compatibility, and excludes assets that are already delisted.
 */
for (let i = 0; i < MAX_ASSETS; i++) {
  scenario(
    `Comet#quoteCollateral > quotes with discount for asset ${i}`,
    {
      filter: async (ctx: CometContext) => await isValidAssetIndex(ctx, i) && await usesAssetList(ctx) && !(await isAssetDelisted(ctx, i)) && await supportsExtendedPause(ctx)
    },
    async ({ comet, configurator, proxyAdmin, actors }, context) => {
      const { admin } = actors;
      const { asset } = await comet.getAssetInfo(i);

      // Get baseScale first to calculate proper QUOTE_AMOUNT
      const baseScale = (await comet.baseScale()).toBigInt();
      // QUOTE_AMOUNT should be in base token units (e.g., 10000 * baseScale for 10000 base tokens)
      const QUOTE_AMOUNT = BigInt(10000) * baseScale;
      
      // Get initial asset info and prices
      let assetInfo = await comet.getAssetInfoByAddress(asset);
      const assetPrice = (await comet.getPrice(assetInfo.priceFeed)).toBigInt();
      const basePrice = (await comet.getPrice(await comet.baseTokenPriceFeed())).toBigInt();
      const factorScale = (await comet.factorScale()).toBigInt();
      const assetScale = assetInfo.scale.toBigInt();
      const liquidationFactor = assetInfo.liquidationFactor.toBigInt();
      const storeFrontPriceFactor = (await comet.storeFrontPriceFactor()).toBigInt();

      // First quote with discount
      const quoteAmount = (await comet.quoteCollateral(asset, QUOTE_AMOUNT)).toBigInt();
      const discountFactor = storeFrontPriceFactor * (factorScale - liquidationFactor) / factorScale;
      const assetPriceDiscounted = assetPrice * (factorScale - discountFactor) / factorScale;
      const expectedQuoteWithDiscount = (basePrice * QUOTE_AMOUNT * assetScale) / assetPriceDiscounted / baseScale;
      expect(quoteAmount).to.equal(expectedQuoteWithDiscount);
      
      await context.setNextBaseFeeToZero();
      await configurator.connect(admin.signer).updateAssetLiquidationFactor(comet.address, asset, 0n, { gasPrice: 0 });
      await context.setNextBaseFeeToZero();
      await proxyAdmin.connect(admin.signer).deployAndUpgradeTo(configurator.address, comet.address, { gasPrice: 0 });

      assetInfo = await comet.getAssetInfoByAddress(asset);
      expect(assetInfo.liquidationFactor).to.equal(0);

      // Second quote without discount
      const quoteAmountWithoutDiscount = (await comet.quoteCollateral(asset, QUOTE_AMOUNT)).toBigInt();
      // When liquidationFactor = 0, no discount is applied, so use assetPrice directly
      const expectedQuoteWithoutDiscount = (basePrice * QUOTE_AMOUNT * assetInfo.scale.toBigInt()) / assetPrice / baseScale;
      // Verify quote calculation
      expect(quoteAmountWithoutDiscount).to.be.closeTo(expectedQuoteWithoutDiscount, BigInt(1e18));
    }
  );
}

