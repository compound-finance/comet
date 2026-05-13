import { AssetList, AssetList__factory, AssetListFactory, AssetListFactory__factory, FaucetToken, FaucetToken__factory, SimplePriceFeed, SimplePriceFeed__factory } from 'build/types';
import { expect, exp, makeConfigurator, ONE, makeProtocol, ethers } from './helpers';

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
    expect(assetInfo00.borrowCollateralFactor).to.equal(ONE - exp(1, 14));
    expect(assetInfo00.liquidateCollateralFactor).to.equal(ONE);

    const assetInfo01 = await comet.getAssetInfo(1);
    expect(assetInfo01.asset).to.be.equal(tokens['ASSET2'].address);
    expect(assetInfo01.borrowCollateralFactor).to.equal(ONE - exp(1, 14));
    expect(assetInfo01.liquidateCollateralFactor).to.equal(ONE);

    const assetInfo02 = await comet.getAssetInfo(2);
    expect(assetInfo02.asset).to.be.equal(tokens['ASSET3'].address);
    expect(assetInfo02.borrowCollateralFactor).to.equal(ONE - exp(1, 14));
    expect(assetInfo02.liquidateCollateralFactor).to.equal(ONE);
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

  describe('factors validation', function () {
    // FACTOR_SCALE / 1e4 — the precision unit factors are truncated to when packed into AssetList storage
    const DESCALE = exp(1, 14);

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
      await assetListFactory.deployed();

      faucetToken = await (await ethers.getContractFactory('FaucetToken') as FaucetToken__factory).deploy(10n ** 24n, 'Test Token', 18, 'TEST');
      await faucetToken.deployed();

      priceFeed = await (await ethers.getContractFactory('SimplePriceFeed') as SimplePriceFeed__factory).deploy(exp(1, 8), 8);
      await priceFeed.deployed();

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
      await assetList.deployed();
    });

    describe('happy cases', function () {
      it('borrowCF > 0, liquidateCF > 0 and borrowCF < liquidateCF', async () => {
        await expect(assetListFactory.createAssetList([{ ...baseAssetConfig }])).to.not.be.reverted;
      });

      it('borrowCF = 0, liquidateCF = 0', async () => {
        await expect(assetListFactory.createAssetList([{ ...baseAssetConfig, borrowCollateralFactor: 0n, liquidateCollateralFactor: 0n }])).to.not.be.reverted;
      });

      it('borrowCF > liquidateF and borrowCF < liquidateCF', async () => {
        await expect(assetListFactory.createAssetList([{
          ...baseAssetConfig,
          borrowCollateralFactor: exp(0.95, 18),
          liquidateCollateralFactor: exp(0.98, 18),
          liquidationFactor: exp(0.9, 18),
        }])).to.not.be.reverted;
      });

      it('borrowCF < liquidateCF and liquidateCF > liquidateF', async () => {
        await expect(assetListFactory.createAssetList([{
          ...baseAssetConfig,
          borrowCollateralFactor: exp(0.7, 18),
          liquidateCollateralFactor: exp(0.95, 18),
          liquidationFactor: exp(0.9, 18),
        }])).to.not.be.reverted;
      });

      it('borrowCF < liquidateCF < liquidateF', async () => {
        await expect(assetListFactory.createAssetList([{
          ...baseAssetConfig,
          borrowCollateralFactor: exp(0.7, 18),
          liquidateCollateralFactor: exp(0.8, 18),
          liquidationFactor: exp(0.95, 18),
        }])).to.not.be.reverted;
      });

      it('borrowCF = 0 and liquidateCF > 0', async () => {
        await expect(assetListFactory.createAssetList([{ ...baseAssetConfig, borrowCollateralFactor: 0n }])).to.not.be.reverted;
      });

      it('borrowCF = 0, liquidateF = 0, liquidateCF > 0', async () => {
        await expect(assetListFactory.createAssetList([{ ...baseAssetConfig, borrowCollateralFactor: 0n, liquidationFactor: 0n }])).to.not.be.reverted;
      });

      it('liquidateCF < MAX_COLLATERAL_FACTOR', async () => {
        await expect(assetListFactory.createAssetList([{ ...baseAssetConfig, liquidateCollateralFactor: ONE - DESCALE }])).to.not.be.reverted;
      });

      it('liquidateCF = MAX_COLLATERAL_FACTOR', async () => {
        await expect(assetListFactory.createAssetList([{ ...baseAssetConfig, liquidateCollateralFactor: ONE }])).to.not.be.reverted;
      });

      it('liquidateF < MAX_COLLATERAL_FACTOR', async () => {
        await expect(assetListFactory.createAssetList([{ ...baseAssetConfig, liquidationFactor: ONE - DESCALE }])).to.not.be.reverted;
      });

      it('liquidateF = MAX_COLLATERAL_FACTOR', async () => {
        await expect(assetListFactory.createAssetList([{ ...baseAssetConfig, liquidationFactor: ONE }])).to.not.be.reverted;
      });
    });

    describe('revert when', function () {
      it('borrowCF > 0, liquidateCF = 0', async () => {
        await expect(assetListFactory.createAssetList([{ ...baseAssetConfig, liquidateCollateralFactor: 0n }]))
          .to.be.revertedWithCustomError(assetList, 'BorrowCFTooLarge');
      });

      it('borrowCF > 0, liquidateCF > 0 and borrowCF > liquidateCF', async () => {
        await expect(assetListFactory.createAssetList([{ ...baseAssetConfig, borrowCollateralFactor: exp(0.9, 18), liquidateCollateralFactor: exp(0.8, 18) }]))
          .to.be.revertedWithCustomError(assetList, 'BorrowCFTooLarge');
      });

      it('borrowCF > 0, liquidateCF > 0 and borrowCF = liquidateCF', async () => {
        await expect(assetListFactory.createAssetList([{ ...baseAssetConfig, borrowCollateralFactor: exp(0.8, 18), liquidateCollateralFactor: exp(0.8, 18) }]))
          .to.be.revertedWithCustomError(assetList, 'BorrowCFTooLarge');
      });

      it('liquidateCF > MAX_COLLATERAL_FACTOR', async () => {
        await expect(assetListFactory.createAssetList([{ ...baseAssetConfig, borrowCollateralFactor: 0n, liquidateCollateralFactor: ONE + 1n }]))
          .to.be.revertedWithCustomError(assetList, 'LiquidateCFTooLarge');
      });

      it('liquidateF > MAX_COLLATERAL_FACTOR', async () => {
        await expect(assetListFactory.createAssetList([{ ...baseAssetConfig, liquidationFactor: ONE + 1n }]))
          .to.be.revertedWithCustomError(assetList, 'LiqPenaltyTooHigh');
      });
    });

    /*
     * Factors are truncated to 4-decimal precision (DESCALE = 1e14) when packed into AssetList
     * storage. A post-descale safety check re-runs the BorrowCFTooLarge guard on packed values,
     * catching cases where original values pass the first check but collapse into the same bin.
     */
    describe('descaled values', function () {
      describe('happy cases', function () {
        it('both factors are exact multiples of DESCALE with a clear gap', async () => {
          // 0.9e18 → 9000 units, 0.91e18 → 9100 units after descale
          await expect(assetListFactory.createAssetList([{
            ...baseAssetConfig,
            borrowCollateralFactor: exp(0.9, 18),
            liquidateCollateralFactor: exp(0.91, 18),
          }])).to.not.be.reverted;
        });

        it('gap is exactly one DESCALE unit — minimum valid separation', async () => {
          // 9000*DESCALE → 9001*DESCALE: packed values differ by 1 unit
          await expect(assetListFactory.createAssetList([{
            ...baseAssetConfig,
            borrowCollateralFactor: exp(0.9, 18),
            liquidateCollateralFactor: exp(0.9, 18) + DESCALE,
          }])).to.not.be.reverted;
        });

        it('borrowCF just below a bin boundary, liquidateCF at that boundary', async () => {
          // borrowCF = 9000*DESCALE - 1 → truncates to bin 8999; liquidateCF = 9000*DESCALE → bin 9000
          await expect(assetListFactory.createAssetList([{
            ...baseAssetConfig,
            borrowCollateralFactor: exp(0.9, 18) - 1n,
            liquidateCollateralFactor: exp(0.9, 18),
          }])).to.not.be.reverted;
        });

        it('borrowCF inside a bin, liquidateCF at the start of the next bin', async () => {
          // borrowCF = 9000*DESCALE + 1 → bin 9000; liquidateCF = 9001*DESCALE → bin 9001
          await expect(assetListFactory.createAssetList([{
            ...baseAssetConfig,
            borrowCollateralFactor: exp(0.9, 18) + 1n,
            liquidateCollateralFactor: exp(0.9, 18) + DESCALE,
          }])).to.not.be.reverted;
        });

        it('borrowCF = 0 with liquidateCF below DESCALE — descale check is skipped', async () => {
          // Packed borrowCollateralFactor = 0 → the != 0 guard short-circuits the descale check
          await expect(assetListFactory.createAssetList([{
            ...baseAssetConfig,
            borrowCollateralFactor: 0n,
            liquidateCollateralFactor: 1n,
          }])).to.not.be.reverted;
        });
      });

      describe('revert when', function () {
        it('gap = 1: liquidateCF is in the same bin as borrowCF after truncation', async () => {
          // 9000*DESCALE and 9000*DESCALE + 1 both truncate to 9000 → equal after descale
          await expect(assetListFactory.createAssetList([{
            ...baseAssetConfig,
            borrowCollateralFactor: exp(0.9, 18),
            liquidateCollateralFactor: exp(0.9, 18) + 1n,
          }])).to.be.revertedWithCustomError(assetList, 'BorrowCFTooLarge');
        });

        it('gap = DESCALE - 1: maximum same-bin gap — liquidateCF still truncates to the same bin', async () => {
          // 9001*DESCALE - 1 truncates to 9000, same as 9000*DESCALE
          await expect(assetListFactory.createAssetList([{
            ...baseAssetConfig,
            borrowCollateralFactor: exp(0.9, 18),
            liquidateCollateralFactor: exp(0.9, 18) + DESCALE - 1n,
          }])).to.be.revertedWithCustomError(assetList, 'BorrowCFTooLarge');
        });

        it('both values are non-zero and inside the same bin', async () => {
          // borrowCF = 9000*DESCALE + 1, liquidateCF = 9001*DESCALE - 1 → both truncate to 9000
          await expect(assetListFactory.createAssetList([{
            ...baseAssetConfig,
            borrowCollateralFactor: exp(0.9, 18) + 1n,
            liquidateCollateralFactor: exp(0.9, 18) + DESCALE - 1n,
          }])).to.be.revertedWithCustomError(assetList, 'BorrowCFTooLarge');
        });

        it('same-bin collision at a different factor magnitude', async () => {
          // 7000*DESCALE and 7000*DESCALE + 1 both truncate to 7000 → equal after descale
          await expect(assetListFactory.createAssetList([{
            ...baseAssetConfig,
            borrowCollateralFactor: exp(0.7, 18),
            liquidateCollateralFactor: exp(0.7, 18) + 1n,
          }])).to.be.revertedWithCustomError(assetList, 'BorrowCFTooLarge');
        });
      });
    });
  });
});
