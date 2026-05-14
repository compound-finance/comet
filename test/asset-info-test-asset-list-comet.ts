import { AssetInfoStructOutput } from 'build/types/AssetList';
import { AssetList, AssetList__factory, AssetListFactory, AssetListFactory__factory, FaucetToken, FaucetToken__factory, SimplePriceFeed, SimplePriceFeed__factory } from '../build/types';
import { ethers, expect, exp, makeConfigurator, makeProtocol } from './helpers';

// Covers all valid AssetList collateral factor configurations (active, soft de-listed,
// fully de-listed, non-liquidatable) and all invalid factor orderings that must revert.
// Validation rule: BCF < LCF < LF <= MAX_COLLATERAL_FACTOR, with exceptions when
// BCF = 0 (soft or full de-list) and when all three are 0 (non-liquidatable).
//
// Note: the base Comet.sol has stricter validation (no BCF=0 exception), so fully
// de-listed and non-liquidatable configs are tested against AssetList directly.
describe('asset info', function () {
  it('initializes protocol', async () => {
    const { cometWithExtendedAssetList: comet, tokens } = await makeConfigurator({
      assets: {
        USDC: {},
        ASSET1: {},
        ASSET2: {},
        ASSET3: {},
      },
      reward: 'ASSET1',
    });

    const cometNumAssets = await comet.numAssets();
    expect(cometNumAssets).to.be.equal(3);

    const assetInfo00 = await comet.getAssetInfo(0);
    expect(assetInfo00.asset).to.be.equal(tokens['ASSET1'].address);
    expect(assetInfo00.borrowCollateralFactor).to.equal(exp(0.8, 18));
    expect(assetInfo00.liquidateCollateralFactor).to.equal(exp(0.85, 18));

    const assetInfo01 = await comet.getAssetInfo(1);
    expect(assetInfo01.asset).to.be.equal(tokens['ASSET2'].address);
    expect(assetInfo01.borrowCollateralFactor).to.equal(exp(0.8, 18));
    expect(assetInfo01.liquidateCollateralFactor).to.equal(exp(0.85, 18));

    const assetInfo02 = await comet.getAssetInfo(2);
    expect(assetInfo02.asset).to.be.equal(tokens['ASSET3'].address);
    expect(assetInfo02.borrowCollateralFactor).to.equal(exp(0.8, 18));
    expect(assetInfo02.liquidateCollateralFactor).to.equal(exp(0.85, 18));
  });

  it('reverts if too many assets are passed', async () => {
    await expect(
      makeProtocol({
        assets: {
          USDC: {},
          ASSET1: {},
          ASSET2: {},
          ASSET3: {},
          ASSET4: {},
          ASSET5: {},
          ASSET6: {},
          ASSET7: {},
          ASSET8: {},
          ASSET9: {},
          ASSET10: {},
          ASSET11: {},
          ASSET12: {},
          ASSET13: {},
          ASSET14: {},
          ASSET15: {},
          ASSET16: {},
          ASSET17: {},
          ASSET18: {},
          ASSET19: {},
          ASSET20: {},
          ASSET21: {},
          ASSET22: {},
          ASSET23: {},
          ASSET24: {},
          ASSET25: {},
        },
        reward: 'ASSET1',
      })
    ).to.be.revertedWith("custom error 'TooManyAssets()'");
  });

  it('reverts if index is greater than numAssets', async () => {
    const { cometWithExtendedAssetList } = await makeConfigurator();
    await expect(cometWithExtendedAssetList.getAssetInfo(3)).to.be.revertedWith("custom error 'BadAsset()'");
  });

  context('collateral factors validation', function () {
    let assetList: AssetList;
    let assetListFactory: AssetListFactory;
    let faucetToken: FaucetToken;
    let priceFeed: SimplePriceFeed;

    // Base valid config; each test spreads this and overrides only the field(s) under test.
    let baseAssetConfig: {
      asset: string;
      priceFeed: string;
      decimals: number;
      borrowCollateralFactor: bigint;
      liquidateCollateralFactor: bigint;
      liquidationFactor: bigint;
      supplyCap: bigint;
    };

    before(async () => {
      assetListFactory = await (await ethers.getContractFactory('AssetListFactory') as AssetListFactory__factory).deploy();

      faucetToken = await (await ethers.getContractFactory('FaucetToken') as FaucetToken__factory).deploy(10n ** 24n, 'Test Token', 18, 'TEST');

      priceFeed = await (await ethers.getContractFactory('SimplePriceFeed') as SimplePriceFeed__factory).deploy(exp(1, 8), 8);

      baseAssetConfig = {
        asset: faucetToken.address,
        priceFeed: priceFeed.address,
        decimals: 18,
        borrowCollateralFactor: exp(0.75, 18),
        liquidateCollateralFactor: exp(0.8, 18),
        liquidationFactor: exp(0.9, 18),
        supplyCap: 10n ** 24n,
      };

      assetList = await (await ethers.getContractFactory('AssetList') as AssetList__factory).deploy([baseAssetConfig]);
    });

    // normal active collateral
    context('active collateral: BCF > 0, LCF > BCF, LF > LCF', function () {
      let assetInfo: AssetInfoStructOutput;

      before(async () => {
        const assetList = await (await ethers.getContractFactory('AssetList') as AssetList__factory).deploy([{
          ...baseAssetConfig,
          borrowCollateralFactor: exp(0.75, 18),
          liquidateCollateralFactor: exp(0.8, 18),
          liquidationFactor: exp(0.9, 18),
        }]);
        assetInfo = await assetList.getAssetInfo(0);
      });

      it('stores borrowCollateralFactor', () => {
        expect(assetInfo.borrowCollateralFactor).to.equal(exp(0.75, 18));
        expect(assetInfo.borrowCollateralFactor).to.be.greaterThan(0);
      });

      it('stores liquidateCollateralFactor', () => {
        expect(assetInfo.liquidateCollateralFactor).to.equal(exp(0.8, 18));
      });

      it('stores liquidationFactor', () => {
        expect(assetInfo.liquidationFactor).to.equal(exp(0.9, 18));
      });
    });

    // soft de-listed
    describe('soft de-listed collateral: BCF = 0, LCF > 0, LF > LCF', function () {
      let assetInfo: AssetInfoStructOutput;

      before(async () => {
        const assetList = await (await ethers.getContractFactory('AssetList') as AssetList__factory).deploy([{
          ...baseAssetConfig,
          borrowCollateralFactor: 0n,
          liquidateCollateralFactor: exp(0.8, 18),
          liquidationFactor: exp(0.9, 18),
        }]);
        assetInfo = await assetList.getAssetInfo(0);
      });

      it('stores borrowCollateralFactor as zero', () => {
        expect(assetInfo.borrowCollateralFactor).to.equal(0);
      });

      it('stores liquidateCollateralFactor', () => {
        expect(assetInfo.liquidateCollateralFactor).to.equal(exp(0.8, 18));
      });

      it('stores liquidationFactor', () => {
        expect(assetInfo.liquidationFactor).to.equal(exp(0.9, 18));
      });
    });

    // fully de-listed
    describe('fully de-listed collateral: BCF = 0, LCF = 0, LF > 0', function () {
      let assetInfo: AssetInfoStructOutput;

      before(async () => {
        const assetList = await (await ethers.getContractFactory('AssetList') as AssetList__factory).deploy([{
          ...baseAssetConfig,
          borrowCollateralFactor: 0n,
          liquidateCollateralFactor: 0n,
          liquidationFactor: exp(0.9, 18),
        }]);
        assetInfo = await assetList.getAssetInfo(0);
      });

      it('stores borrowCollateralFactor as zero', () => {
        expect(assetInfo.borrowCollateralFactor).to.equal(0);
      });

      it('stores liquidateCollateralFactor as zero', () => {
        expect(assetInfo.liquidateCollateralFactor).to.equal(0);
      });

      it('stores liquidationFactor', () => {
        expect(assetInfo.liquidationFactor).to.equal(exp(0.9, 18));
      });
    });

    // non-liquidatable
    describe('non-liquidatable collateral: BCF = 0, LCF = 0, LF = 0', function () {
      let assetInfo: AssetInfoStructOutput;

      before(async () => {
        const assetList = await (await ethers.getContractFactory('AssetList') as AssetList__factory).deploy([{
          ...baseAssetConfig,
          borrowCollateralFactor: 0n,
          liquidateCollateralFactor: 0n,
          liquidationFactor: 0n,
        }]);
        assetInfo = await assetList.getAssetInfo(0);
      });

      it('stores borrowCollateralFactor as zero', () => {
        expect(assetInfo.borrowCollateralFactor).to.equal(0);
      });

      it('stores liquidateCollateralFactor as zero', () => {
        expect(assetInfo.liquidateCollateralFactor).to.equal(0);
      });

      it('stores liquidationFactor as zero', () => {
        expect(assetInfo.liquidationFactor).to.equal(0);
      });
    });

    // liquidation factor at maximum
    describe('liquidation factor at maximum: LF = 1e18', function () {
      let assetInfo: AssetInfoStructOutput;

      before(async () => {
        const assetList = await (await ethers.getContractFactory('AssetList') as AssetList__factory).deploy([{
          ...baseAssetConfig,
          liquidationFactor: exp(1, 18),
        }]);
        assetInfo = await assetList.getAssetInfo(0);
      });

      it('stores borrowCollateralFactor', () => {
        expect(assetInfo.borrowCollateralFactor).to.equal(exp(0.75, 18));
      });

      it('stores liquidateCollateralFactor', () => {
        expect(assetInfo.liquidateCollateralFactor).to.equal(exp(0.8, 18));
      });

      it('stores liquidationFactor at maximum', () => {
        expect(assetInfo.liquidationFactor).to.equal(exp(1, 18));
      });
    });

    context('revert when', function () {
      // borrow collateral factor too large

      it('BCF equals LCF when both are non-zero', async () => {
        await expect(
          assetListFactory.createAssetList([{ ...baseAssetConfig, borrowCollateralFactor: exp(0.8, 18), liquidateCollateralFactor: exp(0.8, 18) }])
        ).to.be.revertedWithCustomError(assetList, 'BorrowCFTooLarge');
      });

      it('BCF exceeds LCF', async () => {
        await expect(
          assetListFactory.createAssetList([{ ...baseAssetConfig, borrowCollateralFactor: exp(0.9, 18), liquidateCollateralFactor: exp(0.8, 18) }])
        ).to.be.revertedWithCustomError(assetList, 'BorrowCFTooLarge');
      });

      it('BCF is non-zero but LCF is zero', async () => {
        await expect(
          assetListFactory.createAssetList([{ ...baseAssetConfig, liquidateCollateralFactor: 0n }])
        ).to.be.revertedWithCustomError(assetList, 'BorrowCFTooLarge');
      });

      it('BCF and LCF differ by less than one descaled precision unit', async () => {
        // BCF = 7500 * DESCALE, LCF = 7500 * DESCALE + 1 → pass original check (BCF < LCF),
        // but after descaling both become 7500 → descaled check: 7500 >= 7500 → BorrowCFTooLarge.
        await expect(
          assetListFactory.createAssetList([{ ...baseAssetConfig, borrowCollateralFactor: exp(0.75, 18), liquidateCollateralFactor: exp(0.75, 18) + 1n }])
        ).to.be.revertedWithCustomError(assetList, 'BorrowCFTooLarge');
      });

      // liquidate collateral factor too large

      it('LCF equals LF when both are non-zero', async () => {
        await expect(
          assetListFactory.createAssetList([{ ...baseAssetConfig, borrowCollateralFactor: 0n, liquidateCollateralFactor: exp(0.9, 18), liquidationFactor: exp(0.9, 18) }])
        ).to.be.revertedWithCustomError(assetList, 'LiquidateCFTooLarge');
      });

      it('LCF exceeds LF', async () => {
        await expect(
          assetListFactory.createAssetList([{ ...baseAssetConfig, borrowCollateralFactor: 0n, liquidateCollateralFactor: exp(0.9, 18), liquidationFactor: exp(0.8, 18) }])
        ).to.be.revertedWithCustomError(assetList, 'LiquidateCFTooLarge');
      });

      it('LCF is non-zero but LF is zero', async () => {
        // LCF > 0 means LCF >= LF=0 is always true → LiquidateCFTooLarge
        await expect(
          assetListFactory.createAssetList([{ ...baseAssetConfig, borrowCollateralFactor: 0n, liquidationFactor: 0n }])
        ).to.be.revertedWithCustomError(assetList, 'LiquidateCFTooLarge');
      });

      it('LCF and LF differ by less than one descaled precision unit', async () => {
        // LCF = 8000 * DESCALE, LF = 8000 * DESCALE + 1 → pass original check (LCF < LF),
        // but after descaling both become 8000 → descaled check: 8000 >= 8000 → LiquidateCFTooLarge.
        await expect(
          assetListFactory.createAssetList([{ ...baseAssetConfig, borrowCollateralFactor: 0n, liquidateCollateralFactor: exp(0.8, 18), liquidationFactor: exp(0.8, 18) + 1n }])
        ).to.be.revertedWithCustomError(assetList, 'LiquidateCFTooLarge');
      });

      // liquidation penalty too high

      it('LF exceeds MAX_COLLATERAL_FACTOR', async () => {
        await expect(
          assetListFactory.createAssetList([{ ...baseAssetConfig, liquidationFactor: exp(1, 18) + 1n }])
        ).to.be.revertedWithCustomError(assetList, 'LiqPenaltyTooHigh');
      });
    });
  });
});
