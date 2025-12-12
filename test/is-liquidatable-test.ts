import { CometProxyAdmin, CometWithExtendedAssetList, Configurator, FaucetToken, NonStandardFaucetFeeToken } from 'build/types';
import { expect, exp, makeProtocol, makeConfigurator, ethers, updateAssetLiquidateCollateralFactor, getLiquidityWithLiquidateCF, MAX_ASSETS, takeSnapshot, SnapshotRestorer } from './helpers';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';

/*
Prices are set in terms of the base token (USDC with 6 decimals, by default):

  await comet.setBasePrincipal(alice.address, 1_000_000);

But the prices returned are denominated in terms of price scale (USD with 8
decimals, by default)

*/

describe('isLiquidatable', function () {
  it('defaults to false', async () => {
    const protocol = await makeProtocol();
    const {
      comet,
      users: [alice],
    } = protocol;

    expect(await comet.isLiquidatable(alice.address)).to.be.false;
  });

  it('is false when user is owed principal', async () => {
    const {
      comet,
      users: [alice],
    } = await makeProtocol();
    await comet.setBasePrincipal(alice.address, 1_000_000);

    expect(await comet.isLiquidatable(alice.address)).to.be.false;
  });

  it('is true when user owes principal', async () => {
    const {
      comet,
      users: [alice],
    } = await makeProtocol();
    await comet.setBasePrincipal(alice.address, -1_000_000);

    expect(await comet.isLiquidatable(alice.address)).to.be.true;
  });

  it('is false when collateral can cover the borrowed principal', async () => {
    const {
      comet,
      tokens,
      users: [alice],
    } = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
        },
      },
    });
    const { COMP } = tokens;

    // user owes $100,000
    await comet.setBasePrincipal(alice.address, -100_000_000_000);
    // but has $100,000 in COMP to cover
    await comet.setCollateralBalance(alice.address, COMP.address, exp(100_000, 18));

    expect(await comet.isLiquidatable(alice.address)).to.be.false;
  });

  it('is true when the collateral cannot cover the borrowed principal', async () => {
    const {
      comet,
      tokens,
      users: [alice],
    } = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
        },
      },
    });
    const { COMP } = tokens;

    // user owes $100,000 is
    await comet.setBasePrincipal(alice.address, -100_000_000_000);
    // and only has $95,000 in COMP
    await comet.setCollateralBalance(alice.address, COMP.address, exp(95_000, 18));

    expect(await comet.isLiquidatable(alice.address)).to.be.true;
  });

  it('takes liquidateCollateralFactor into account when comparing principal to collateral', async () => {
    const {
      comet,
      tokens,
      users: [alice],
    } = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
          borrowCF: exp(0.75, 18),
          liquidateCF: exp(0.8, 18),
        },
      },
    });
    const { COMP } = tokens;

    // user owes $100,000
    await comet.setBasePrincipal(alice.address, -100_000_000_000);
    // has $100,000 in COMP to cover, but at a .8 liquidateCollateralFactor
    await comet.setCollateralBalance(alice.address, COMP.address, exp(100_000, 18));

    expect(await comet.isLiquidatable(alice.address)).to.be.true;
  });

  it('changes when the underlying asset price changes', async () => {
    const {
      comet,
      tokens,
      users: [alice],
      priceFeeds,
    } = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
        },
      },
    });
    const { COMP } = tokens;

    // user owes $100,000
    await comet.setBasePrincipal(alice.address, -100_000_000_000);
    // has $100,000 in COMP to cover
    await comet.setCollateralBalance(alice.address, COMP.address, exp(100_000, 18));

    expect(await comet.isLiquidatable(alice.address)).to.be.false;

    // price drops
    await priceFeeds.COMP.setRoundData(
      0, // roundId
      exp(0.5, 8), // answer
      0, // startedAt
      0, // updatedAt
      0 // answeredInRound
    );

    expect(await comet.isLiquidatable(alice.address)).to.be.true;
  });

  /**
   * This test suite was written after the USDM incident, when a token price feed was removed from Chainlink.
   * The incident revealed that when a price feed becomes unavailable, the protocol cannot calculate the USD value
   * of collateral (e.g., during absorption when trying to getPrice() for a delisted asset).
   *
   * Flow tested:
   * The `isLiquidatable` function iterates through a user's collateral assets to calculate their total liquidity.
   * When an asset's `liquidateCollateralFactor` is set to 0, the contract skips that asset in the liquidity calculation
   * effectively excluding it from contributing to the user's
   * collateralization. This prevents the protocol from calling `getPrice()` on unavailable price feeds.
   *
   * Test scenarios:
   * 1. Positions with positive liquidateCF are properly collateralized and not liquidatable
   * 2. When liquidateCF is set to 0 (simulating a price feed becoming unavailable), the collateral is excluded
   *    from liquidity calculations, causing positions to become liquidatable
   * 3. Mixed scenarios where some assets have liquidateCF=0 and others have positive values - only assets with
   *    positive liquidateCF contribute to liquidity
   * 4. All assets individually tested to ensure each can be excluded when liquidateCF=0
   *
   * This mitigation allows governance to set liquidateCF to 0 for assets with unavailable price feeds, preventing
   * protocol paralysis while ensuring undercollateralized positions can still be liquidated.
   */
  describe('isLiquidatable semantics across liquidateCollateralFactor values', function () {
    // Snapshot
    let snapshot: SnapshotRestorer;

    // Configurator and protocol
    let comet: CometWithExtendedAssetList;
    let configurator: Configurator;
    let configuratorProxyAddress: string;
    let proxyAdmin: CometProxyAdmin;
    let cometProxyAddress: string;

    // Tokens
    let baseSymbol: string;
    let baseToken: FaucetToken | NonStandardFaucetFeeToken;
    let collateralToken: FaucetToken | NonStandardFaucetFeeToken;
    let tokens: Record<string, FaucetToken | NonStandardFaucetFeeToken>;

    // Users
    let alice: SignerWithAddress;
    let governor: SignerWithAddress;

    // Values
    let supplyAmount: bigint;
    let borrowAmount: bigint;

    let liquidateCF: bigint;

    before(async () => {
      const collaterals = Object.fromEntries(
        Array.from({ length: MAX_ASSETS }, (_, j) => [
          `ASSET${j}`,
          {
            decimals: 18,
            initialPrice: 200,
            borrowCF: exp(0.75, 18),
            liquidateCF: exp(0.8, 18),
          },
        ])
      );
      const protocol = await makeConfigurator({
        assets: { USDC: { decimals: 6, initialPrice: 1 }, ...collaterals }, withMockAssetListFactory: true
      });

      configurator = protocol.configurator;
      configuratorProxyAddress = protocol.configuratorProxy.address;
      proxyAdmin = protocol.proxyAdmin;
      cometProxyAddress = protocol.cometProxy.address;
      comet = protocol.cometWithExtendedAssetList.attach(cometProxyAddress) as CometWithExtendedAssetList;

      baseSymbol = protocol.base;
      baseToken = protocol.tokens[baseSymbol];
      collateralToken = protocol.tokens['ASSET0'];
      tokens = protocol.tokens;
      alice = protocol.users[0];
      governor = protocol.governor;

      // Upgrade proxy to extended asset list implementation to support many assets
      const assetListFactory = protocol.assetListFactory;
      configurator = configurator.attach(configuratorProxyAddress);
      const CometExtAssetList = await (
        await ethers.getContractFactory('CometExtAssetList')
      ).deploy(
        {
          name32: ethers.utils.formatBytes32String('Compound Comet'),
          symbol32: ethers.utils.formatBytes32String('BASE'),
        },
        assetListFactory.address
      );
      await CometExtAssetList.deployed();
      await configurator.setExtensionDelegate(cometProxyAddress, CometExtAssetList.address);
      const CometFactoryWithExtendedAssetList = await (await ethers.getContractFactory('CometFactoryWithExtendedAssetList')).deploy();
      await CometFactoryWithExtendedAssetList.deployed();
      await configurator.setFactory(cometProxyAddress, CometFactoryWithExtendedAssetList.address);
      await proxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);

      liquidateCF = (await comet.getAssetInfoByAddress(collateralToken.address)).liquidateCollateralFactor.toBigInt();

      snapshot = await takeSnapshot();

      // Supply collateral and borrow base
      supplyAmount = exp(10, 18);
      borrowAmount = exp(5, 6);

      await collateralToken.allocateTo(alice.address, supplyAmount);
      await collateralToken.connect(alice).approve(cometProxyAddress, supplyAmount);
      await comet.connect(alice).supply(collateralToken.address, supplyAmount);

      await baseToken.allocateTo(cometProxyAddress, borrowAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // With positive liquidateCF and ample collateral, not liquidatable
      expect(await comet.isLiquidatable(alice.address)).to.be.false;
    });

    it('liquidity calculation includes collateral with positive liquidateCF', async () => {
      const liquidity = await getLiquidityWithLiquidateCF(comet, collateralToken, supplyAmount);
      expect(liquidity).to.be.greaterThan(0);
    });

    it('liquidateCF can be updated to 0', async () => {
      await updateAssetLiquidateCollateralFactor(configurator, proxyAdmin, cometProxyAddress, collateralToken.address, 0n, governor);
    });

    it('liquidateCF becomes 0 after upgrade', async () => {
      expect((await comet.getAssetInfoByAddress(collateralToken.address)).liquidateCollateralFactor).to.equal(0);
    });

    it('liquidity calculation excludes collateral with zero liquidateCF', async () => {
      const liquidity = await getLiquidityWithLiquidateCF(comet, collateralToken, supplyAmount);
      expect(liquidity).to.equal(0);
    });

    it('position becomes liquidatable when liquidateCF is set to 0', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.be.true;

      await snapshot.restore();
    });

    it('liquidateCF can be restored back', async function () {
      await updateAssetLiquidateCollateralFactor(configurator, proxyAdmin, cometProxyAddress, collateralToken.address, (liquidateCF), governor);
    });

    it('liquidateCF is restored back after upgrade', async function () {
      expect((await comet.getAssetInfoByAddress(collateralToken.address)).liquidateCollateralFactor).to.equal(liquidateCF);
    });

    it('position is not liquidatable when liquidateCF is restored back', async function () {
      expect(await comet.isLiquidatable(alice.address)).to.be.false;
    });

    it('liquidity calculation includes collateral with positive liquidateCF after restore', async function () {
      const liquidity = await getLiquidityWithLiquidateCF(comet, collateralToken, supplyAmount);
      expect(liquidity).to.be.greaterThan(0);
    });

    it('isLiquidatable with mixed liquidate factors counts only positive CF assets', async () => {
      // Supply equal collateral in all 5 assets
      const supplyAmount = exp(1, 18);
      const symbols = ['ASSET0', 'ASSET1', 'ASSET2', 'ASSET3', 'ASSET4'];
      for (const sym of symbols) {
        const token = tokens[sym];
        await token.allocateTo(alice.address, supplyAmount);
        await token.connect(alice).approve(comet.address, supplyAmount);
        await comet.connect(alice).supply(token.address, supplyAmount);
      }

      // Borrow base against the collateral
      // With 5 assets at price 200, liquidateCF 0.8: each asset contributes ~160 USDC liquidation value
      // Total liquidation value: 5 * 160 = 800 USDC. Borrow 400 so not liquidatable initially.
      // After zeroing 3 assets, only 2 contribute (320 total) < 400 borrowed, so liquidatable.
      const borrowAmount = exp(400, 6);
      await baseToken.allocateTo(comet.address, borrowAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Verify NOT liquidatable initially
      expect(await comet.isLiquidatable(alice.address)).to.be.false;

      // Zero liquidateCF for three assets: ASSET1, ASSET3, ASSET4
      const zeroLcfSymbols = ['ASSET1', 'ASSET3', 'ASSET4'];
      for (const sym of zeroLcfSymbols) {
        await updateAssetLiquidateCollateralFactor(configurator, proxyAdmin, comet.address, tokens[sym].address, 0n, governor);
      }

      // Verify liquidateCF=0 excludes those assets from liquidity
      const liquidityByAsset: Record<string, BigNumber> = {} as Record<string, BigNumber>;
      for (const sym of symbols) {
        liquidityByAsset[sym] = await getLiquidityWithLiquidateCF(comet, tokens[sym], supplyAmount);
      }

      for (const sym of zeroLcfSymbols) {
        expect(liquidityByAsset[sym].eq(0)).to.be.true;
      }
      for (const sym of ['ASSET0', 'ASSET2']) {
        expect(liquidityByAsset[sym].gt(0)).to.be.true;
      }

      // With only two assets contributing (price 200, liquidateCF 0.8),
      // each contributes ~160 USDC, total ~320 USDC vs 400 borrowed
      // Position should become liquidatable
      expect(await comet.isLiquidatable(alice.address)).to.be.true;

      await snapshot.restore();
    });

    for (let i = 1; i <= MAX_ASSETS; i++) {
      it(`skips liquidation value of asset ${i - 1} with liquidateCF=0`, async () => {
        const supplyAmount = exp(1, 18);
        const targetSymbol = `ASSET${i - 1}`;
        const targetToken = tokens[targetSymbol];
        await targetToken.allocateTo(alice.address, supplyAmount);
        await targetToken.connect(alice).approve(comet.address, supplyAmount);
        await comet.connect(alice).supply(targetToken.address, supplyAmount);

        // Borrow amount collateralized by the single supplied asset under liquidation values (~170 USDC)
        const borrowAmount = exp(150, 6);
        await baseToken.allocateTo(comet.address, borrowAmount);
        await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

        // Initially not liquidatable with positive liquidateCF
        expect(await comet.isLiquidatable(alice.address)).to.be.false;

        // Zero liquidateCF for target asset (last one)
        await updateAssetLiquidateCollateralFactor(configurator, proxyAdmin, comet.address, targetToken.address, 0n, governor);

        expect((await comet.getAssetInfoByAddress(targetToken.address)).liquidateCollateralFactor).to.equal(0);

        // After zeroing the only supplied asset's liquidateCF, position should be liquidatable
        expect(await comet.isLiquidatable(alice.address)).to.equal(true);

        await snapshot.restore();
      });
    }
  });
});
