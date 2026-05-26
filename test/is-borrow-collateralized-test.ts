import { CometExt, CometProxyAdmin, Configurator, CometHarnessInterfaceExtendedAssetList as CometWithExtendedAssetList, FaucetToken, NonStandardFaucetFeeToken, PriceFeedWithRevert, PriceFeedWithRevert__factory } from 'build/types';
import { expect, exp, makeProtocol, makeConfigurator, ethers, updateAssetBorrowCollateralFactor, getLiquidity, SnapshotRestorer, takeSnapshot, MAX_ASSETS } from './helpers';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';

describe('isBorrowCollateralized', function () {
  it('defaults to true', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const {
      comet,
      users: [alice],
    } = protocol;

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.true;
  });

  it('is true when user is owed principal', async () => {
    const {
      comet,
      users: [alice],
    } = await makeProtocol({ base: 'USDC' });
    await comet.setBasePrincipal(alice.address, 1_000_000);

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.true;
  });

  it('is false when user owes principal', async () => {
    const {
      comet,
      users: [alice],
    } = await makeProtocol({ base: 'USDC' });

    await comet.setBasePrincipal(alice.address, -1_000_000);

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.false;
  });

  it('is true when value of collateral is greater than principal owed', async () => {
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
          borrowCF: exp(0.9, 18),
        },
      },
    });
    const { COMP } = tokens;

    // user owes 1 USDC, but has 1.2 COMP collateral
    await comet.setBasePrincipal(alice.address, -exp(1, 6));
    await comet.setCollateralBalance(alice.address, COMP.address, exp(1.2, 18));

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.true;
  });

  it('takes borrow collateral factor into account when valuing collateral', async () => {
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
          borrowCF: exp(0.9, 18),
        },
      },
    });
    const { COMP } = tokens;

    // user owes 1 USDC
    await comet.setBasePrincipal(alice.address, -1_000_000);
    // user has 1 COMP collateral, but the borrow collateral factor puts it
    // below the required collateral amount
    await comet.setCollateralBalance(alice.address, COMP.address, exp(1, 18));

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.false;
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
          initialPrice: 1,
          borrowCF: exp(0.2, 18),
        },
      },
    });
    const { COMP } = tokens;

    // user owes 1 USDC
    await comet.setBasePrincipal(alice.address, -exp(1, 6));
    // ...but has 5 COMP to cover their position
    await comet.setCollateralBalance(alice.address, COMP.address, exp(5, 18));

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.true;

    await priceFeeds.COMP.setRoundData(
      0, // roundId
      exp(0.5, 8), // answer
      0, // startedAt
      0, // updatedAt
      0 // answeredInRound
    );

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.false;
  });

  /**
   * This test suite was written after the USDM incident, when a token price feed was removed from Chainlink.
   * The incident revealed that when a price feed becomes unavailable, the protocol cannot calculate the USD value
   * of collateral (e.g., during absorption when trying to getPrice() for a delisted asset).
   *
   * Flow tested:
   * The `isBorrowCollateralized` function iterates through a user's collateral assets to calculate their total liquidity.
   * When an asset's `borrowCollateralFactor` is set to 0, the contract skips that asset in the liquidity calculation
   * (see CometWithExtendedAssetList.sol lines 402-405), effectively excluding it from contributing to the user's
   * collateralization. This prevents the protocol from calling `getPrice()` on unavailable price feeds.
   *
   * Test scenarios:
   * 1. Positions with positive borrowCF are properly collateralized and can borrow
   * 2. When borrowCF is set to 0 (simulating a price feed becoming unavailable), the collateral is excluded
   *    from liquidity calculations, causing positions to become undercollateralized and preventing further borrowing
   * 3. Mixed scenarios where some assets have borrowCF=0 and others have positive values - only assets with
   *    positive borrowCF contribute to liquidity
   * 4. All assets individually tested to ensure each can be excluded when borrowCF=0
   *
   * This mitigation allows governance to set borrowCF to 0 for assets with unavailable price feeds, preventing
   * protocol paralysis while ensuring users cannot borrow against collateral that cannot be properly valued.
   * Unlike `isLiquidatable` which uses `liquidateCollateralFactor`, this function determines whether a user
   * can initiate new borrows, making it critical for preventing new positions from being opened with
   * unpriceable collateral.
   */
  describe('isBorrowCollateralized semantics across borrowCollateralFactor values', function () {
    // Snapshot
    let snapshot: SnapshotRestorer;

    // Configurator and protocol
    let configurator: Configurator;
    let configuratorProxyAddress: string;
    let proxyAdmin: CometProxyAdmin;
    let cometProxyAddress: string;
    let comet: CometWithExtendedAssetList;
    let priceFeedWithRevert: PriceFeedWithRevert;

    // Tokens
    let baseSymbol: string;
    let baseToken: FaucetToken | NonStandardFaucetFeeToken;
    let collateralToken: FaucetToken | NonStandardFaucetFeeToken;
    let tokens: Record<string, FaucetToken | NonStandardFaucetFeeToken>;

    // Users
    let alice: SignerWithAddress;
    let pauseGuardian: SignerWithAddress;

    // Values
    let supplyAmount: bigint;
    let borrowAmount: bigint;

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
      const protocol = await makeConfigurator({ assets: { USDC: { decimals: 6, initialPrice: 1 }, ...collaterals }});

      configurator = protocol.configurator;
      configuratorProxyAddress = protocol.configuratorProxy.address;
      proxyAdmin = protocol.proxyAdmin;
      cometProxyAddress = protocol.cometProxy.address;
      comet = protocol.cometWithExtendedAssetList.attach(cometProxyAddress) as CometWithExtendedAssetList;
      tokens = protocol.tokens;

      baseSymbol = protocol.base;
      baseToken = protocol.tokens[baseSymbol];
      collateralToken = protocol.tokens['ASSET0'];
      alice = protocol.users[0];
      pauseGuardian = protocol.pauseGuardian;

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

      // Deploy a price feed that always reverts on latestRoundData
      const PriceFeedWithRevertFactory = (await ethers.getContractFactory('PriceFeedWithRevert')) as PriceFeedWithRevert__factory;
      priceFeedWithRevert = await PriceFeedWithRevertFactory.deploy(100, 8);

      snapshot = await takeSnapshot();

      // Supply collateral and borrow base
      supplyAmount = exp(10, 18);
      borrowAmount = exp(5, 6);

      await collateralToken.allocateTo(alice.address, supplyAmount);
      await collateralToken.connect(alice).approve(cometProxyAddress, supplyAmount);
      await comet.connect(alice).supply(collateralToken.address, supplyAmount);

      await baseToken.allocateTo(cometProxyAddress, borrowAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // With positive borrowCF, position is collateralized
      expect(await comet.isBorrowCollateralized(alice.address)).to.be.true;
    });

    it('liquidity calculation includes collateral with positive borrowCF', async () => {
      const liquidity = await getLiquidity(comet, collateralToken, supplyAmount);
      expect(liquidity).to.be.greaterThan(0);
    });

    it('borrowCF can be updated to 0', async () => {
      await updateAssetBorrowCollateralFactor(configurator, proxyAdmin, cometProxyAddress, collateralToken.address, 0n);
    });

    it('borrowCF becomes 0 after upgrade', async () => {
      expect((await comet.getAssetInfoByAddress(collateralToken.address)).borrowCollateralFactor).to.equal(0);
    });

    it('liquidity calculation excludes collateral with zero borrowCF', async () => {
      const liquidity = await getLiquidity(comet, collateralToken, supplyAmount);
      expect(liquidity).to.eq(0);
    });

    it('collateralization becomes false when borrowCF is set to 0', async () => {
      expect(await comet.isBorrowCollateralized(alice.address)).to.be.false;

      await snapshot.restore();
    });

    it('isBorrowCollateralized with mixed borrow factors counts only positive CF assets', async () => {
      /**
       * This test verifies that when some assets have
       * borrowCollateralFactor set to 0, they contribute zero liquidity and
       * are ignored by isBorrowCollateralized, while assets with positive
       * borrowCF still count toward collateralization.
       */

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
      // With 5 assets at price 200, borrowCF 0.9: each asset contributes ~180 USDC liquidity
      // Total liquidity: 5 * 180 = 900 USDC. Borrow 400 to stay well collateralized initially.
      // After zeroing 3 assets, only 2 contribute (360 total) < 400 borrowed, so undercollateralized.
      const borrowAmount = exp(400, 6);
      await baseToken.allocateTo(comet.address, borrowAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Verify collateralized initially
      expect(await comet.isBorrowCollateralized(alice.address)).to.be.true;

      // Zero borrowCF for three assets: ASSET1, ASSET3, ASSET4
      const zeroBcfSymbols = ['ASSET1', 'ASSET3', 'ASSET4'];
      for (const sym of zeroBcfSymbols) {
        await updateAssetBorrowCollateralFactor(configurator, proxyAdmin, cometProxyAddress, tokens[sym].address, 0n);
      }

      // Verify borrowCF=0 excludes those assets from liquidity
      const liquidityByAsset: Record<string, BigNumber> = {} as Record<string, BigNumber>;
      for (const sym of symbols) {
        liquidityByAsset[sym] = await getLiquidity(comet, tokens[sym], supplyAmount);
      }

      for (const sym of zeroBcfSymbols) {
        expect(liquidityByAsset[sym].eq(0)).to.be.true;
      }
      for (const sym of ['ASSET0', 'ASSET2']) {
        expect(liquidityByAsset[sym].gt(0)).to.be.true;
      }

      // With only two assets contributing (price 200, borrowCF 0.9),
      // each contributes ~180 USDC liquidity, total ~360 USDC vs 400 borrowed
      // Position should be undercollateralized
      expect(await comet.isBorrowCollateralized(alice.address)).to.be.false;

      await snapshot.restore();
    });

    for (let i = 1; i <= MAX_ASSETS; i++) {
      it(`skips liquidity of asset ${i - 1} with borrowCF=0`, async () => {
        const supplyAmount = exp(1, 18);
        const targetSymbol = `ASSET${i - 1}`;
        const targetToken = tokens[targetSymbol];
        await targetToken.allocateTo(alice.address, supplyAmount);
        await targetToken.connect(alice).approve(comet.address, supplyAmount);
        await comet.connect(alice).supply(targetToken.address, supplyAmount);

        // Borrow an amount collateralized by the single supplied asset (~180 USDC liquidity)
        const borrowAmount = exp(150, 6);
        await baseToken.allocateTo(comet.address, borrowAmount);
        await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

        // Initially collateralized with single asset active
        expect(await comet.isBorrowCollateralized(alice.address)).to.be.true;

        // Zero borrowCF for target asset (last one)
        await updateAssetBorrowCollateralFactor(configurator, proxyAdmin, cometProxyAddress, targetToken.address, 0n);

        // Verify target asset liquidity is zero
        const liq = await getLiquidity(comet, targetToken, supplyAmount);
        expect(liq).to.equal(0);

        // After zeroing the only supplied asset's borrowCF, position should be undercollateralized
        expect(await comet.isBorrowCollateralized(alice.address)).to.equal(false);

        await snapshot.restore();
      });
    }
    
    describe('edge cases', function () {
      /*
       * Tests three resolution paths for price-feed paralysis in isBorrowCollateralized: restoring
       * the original feed, setting borrowCF to 0, and deactivating the collateral via the pause
       * guardian. Each path proves that the Reverted error from a broken feed can be unblocked.
       */
      describe('revert on price feed side', function () {
        let originalPriceFeed: string;

        before(async () => {
          // Restore to the common baseline for this semantics suite
          await snapshot.restore();

          // Make Alice's position (collateral supply and base borrow)
          supplyAmount = exp(10, 18);
          borrowAmount = exp(5, 6);
          await collateralToken.allocateTo(alice.address, supplyAmount);
          await collateralToken.connect(alice).approve(cometProxyAddress, supplyAmount);
          await comet.connect(alice).supply(collateralToken.address, supplyAmount);
          await baseToken.allocateTo(cometProxyAddress, borrowAmount);
          await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

          // Capture the current (normal) price feed for the collateral token
          originalPriceFeed = (await comet.getAssetInfoByAddress(collateralToken.address)).priceFeed;

          // Deploy a price feed that always reverts on latestRoundData
          const PriceFeedWithRevertFactory = (await ethers.getContractFactory('PriceFeedWithRevert')) as PriceFeedWithRevert__factory;
          priceFeedWithRevert = await PriceFeedWithRevertFactory.deploy(100, 8);
          await priceFeedWithRevert.deployed();
        });

        it('sanity check: isBorrowCollateralized works with the normal price feed', async () => {
          expect(await comet.isBorrowCollateralized(alice.address)).to.be.true;
        });

        it('governance updates collateral price feed to a reverting implementation', async () => {
          await configurator.updateAssetPriceFeed(cometProxyAddress, collateralToken.address, priceFeedWithRevert.address);
          await proxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);
        });

        it('price feed for collateral asset is now the reverting implementation', async () => {
          expect((await comet.getAssetInfoByAddress(collateralToken.address)).priceFeed).to.equal(priceFeedWithRevert.address);
        });

        it('isBorrowCollateralized reverts when collateral price feed reverts', async () => {
          await expect(
            comet.isBorrowCollateralized(alice.address)
          ).to.be.revertedWithCustomError(priceFeedWithRevert, 'Reverted');
        });

        it('governance restores the normal collateral price feed', async () => {
          await configurator.updateAssetPriceFeed(cometProxyAddress, collateralToken.address, originalPriceFeed);
          await proxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);
        });

        it('price feed for collateral asset is restored to the normal implementation', async () => {
          expect((await comet.getAssetInfoByAddress(collateralToken.address)).priceFeed).to.equal(originalPriceFeed);
        });

        it('isBorrowCollateralized works again after restoring the normal price feed', async () => {
          expect(await comet.isBorrowCollateralized(alice.address)).to.be.true;
        });
      });

      /*
       * Demonstrates that setting borrowCollateralFactor to 0 resolves price-feed paralysis:
       * once governance zeros a reverting asset's borrowCF, isBorrowCollateralized skips that
       * asset's getPrice() call entirely and returns normally instead of reverting.
       */
      describe('zero borrowCF resolves price feed paralysis in isBorrowCollateralized', function () {
        before(async () => {
          await snapshot.restore();

          supplyAmount = exp(10, 18);
          borrowAmount = exp(5, 6);
          await collateralToken.allocateTo(alice.address, supplyAmount);
          await collateralToken.connect(alice).approve(cometProxyAddress, supplyAmount);
          await comet.connect(alice).supply(collateralToken.address, supplyAmount);
          await baseToken.allocateTo(cometProxyAddress, borrowAmount);
          await comet.connect(alice).withdraw(baseToken.address, borrowAmount);
        });

        it('isBorrowCollateralized works with the normal price feed', async () => {
          expect(await comet.isBorrowCollateralized(alice.address)).to.be.true;
        });

        it('governance updates collateral price feed to a reverting implementation', async () => {
          await configurator.updateAssetPriceFeed(cometProxyAddress, collateralToken.address, priceFeedWithRevert.address);
          await proxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);
        });

        it('price feed for collateral asset is now the reverting implementation', async () => {
          expect((await comet.getAssetInfoByAddress(collateralToken.address)).priceFeed).to.equal(priceFeedWithRevert.address);
        });

        it('isBorrowCollateralized reverts when collateral price feed reverts', async () => {
          await expect(comet.isBorrowCollateralized(alice.address)).to.be.revertedWithCustomError(priceFeedWithRevert, 'Reverted');
        });

        it('governance sets borrowCollateralFactor to 0 for the affected asset', async () => {
          await updateAssetBorrowCollateralFactor(configurator, proxyAdmin, cometProxyAddress, collateralToken.address, 0n);
        });

        it('borrowCollateralFactor is 0 after upgrade', async () => {
          expect((await comet.getAssetInfoByAddress(collateralToken.address)).borrowCollateralFactor).to.equal(0);
        });

        it('isBorrowCollateralized succeeds and position is undercollateralized after borrowCF is set to 0', async () => {
          expect(await comet.isBorrowCollateralized(alice.address)).to.be.false;
        });
      });

      /*
       * Demonstrates that deactivating a collateral via the pause guardian resolves price-feed
       * paralysis: the deactivation check in isBorrowCollateralized runs before any getPrice()
       * call, so the function now reverts with the protocol-controlled TokenIsDeactivated error
       * instead of the uncontrolled external Reverted error from the broken price feed.
       */
      describe('token deactivation resolves price feed paralysis in isBorrowCollateralized', function () {
        let cometExt: CometExt;
        let collateralAssetIndex: number;

        before(async () => {
          await snapshot.restore();

          supplyAmount = exp(10, 18);
          borrowAmount = exp(5, 6);
          await collateralToken.allocateTo(alice.address, supplyAmount);
          await collateralToken.connect(alice).approve(cometProxyAddress, supplyAmount);
          await comet.connect(alice).supply(collateralToken.address, supplyAmount);
          await baseToken.allocateTo(cometProxyAddress, borrowAmount);
          await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

          collateralAssetIndex = (await comet.getAssetInfoByAddress(collateralToken.address)).offset;
          cometExt = comet.attach(cometProxyAddress) as CometExt;
        });

        it('isBorrowCollateralized works with the normal price feed', async () => {
          expect(await comet.isBorrowCollateralized(alice.address)).to.be.true;
        });

        it('governance updates collateral price feed to a reverting implementation', async () => {
          await configurator.updateAssetPriceFeed(cometProxyAddress, collateralToken.address, priceFeedWithRevert.address);
          await proxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);
        });

        it('price feed for collateral asset is now the reverting implementation', async () => {
          expect((await comet.getAssetInfoByAddress(collateralToken.address)).priceFeed).to.equal(priceFeedWithRevert.address);
        });

        it('isBorrowCollateralized reverts when collateral price feed reverts', async () => {
          await expect(comet.isBorrowCollateralized(alice.address)).to.be.revertedWithCustomError(priceFeedWithRevert, 'Reverted');
        });

        it('pause guardian deactivates the affected collateral', async () => {
          await expect(cometExt.connect(pauseGuardian).deactivateCollateral(collateralAssetIndex)).to.not.be.reverted;
        });

        it('collateral is marked as deactivated', async () => {
          expect(await comet.isCollateralDeactivated(collateralAssetIndex)).to.be.true;
        });

        it('isBorrowCollateralized reverts with TokenIsDeactivated instead of Reverted', async () => {
          await expect(comet.isBorrowCollateralized(alice.address)).to.be.revertedWithCustomError(comet, 'TokenIsDeactivated').withArgs(collateralToken.address);
        });
      });

      /*
       * Demonstrates the two-step mitigation sequence: zeroing borrowCF first stops the
       * external price-feed revert in isBorrowCollateralized, then deactivating the token
       * re-reverts the function but with the protocol-controlled TokenIsDeactivated error
       * instead of the uncontrolled external Reverted error from the broken price feed.
       */
      describe('zero borrowCF unblocks price feed paralysis, then deactivation re-reverts with TokenIsDeactivated', function () {
        let cometExt: CometExt;
        let collateralAssetIndex: number;

        before(async () => {
          await snapshot.restore();

          supplyAmount = exp(10, 18);
          borrowAmount = exp(5, 6);
          await collateralToken.allocateTo(alice.address, supplyAmount);
          await collateralToken.connect(alice).approve(cometProxyAddress, supplyAmount);
          await comet.connect(alice).supply(collateralToken.address, supplyAmount);
          await baseToken.allocateTo(cometProxyAddress, borrowAmount);
          await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

          collateralAssetIndex = (await comet.getAssetInfoByAddress(collateralToken.address)).offset;
          cometExt = comet.attach(cometProxyAddress) as CometExt;
        });

        it('isBorrowCollateralized works with the normal price feed', async () => {
          expect(await comet.isBorrowCollateralized(alice.address)).to.be.true;
        });

        it('governance updates collateral price feed to a reverting implementation', async () => {
          await configurator.updateAssetPriceFeed(cometProxyAddress, collateralToken.address, priceFeedWithRevert.address);
          await proxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);
        });

        it('isBorrowCollateralized reverts when collateral price feed reverts', async () => {
          await expect(comet.isBorrowCollateralized(alice.address)).to.be.revertedWithCustomError(priceFeedWithRevert, 'Reverted');
        });

        it('governance sets borrowCollateralFactor to 0 for the affected asset', async () => {
          await updateAssetBorrowCollateralFactor(configurator, proxyAdmin, cometProxyAddress, collateralToken.address, 0n);
        });

        it('borrowCollateralFactor is 0 after upgrade', async () => {
          expect((await comet.getAssetInfoByAddress(collateralToken.address)).borrowCollateralFactor).to.equal(0);
        });

        it('isBorrowCollateralized no longer reverts after borrowCF is zeroed', async () => {
          expect(await comet.isBorrowCollateralized(alice.address)).to.be.false;
        });

        it('pause guardian deactivates the affected collateral', async () => {
          await expect(cometExt.connect(pauseGuardian).deactivateCollateral(collateralAssetIndex)).to.not.be.reverted;
        });

        it('collateral is marked as deactivated', async () => {
          expect(await comet.isCollateralDeactivated(collateralAssetIndex)).to.be.true;
        });

        it('isBorrowCollateralized reverts with TokenIsDeactivated after deactivation', async () => {
          await expect(comet.isBorrowCollateralized(alice.address)).to.be.revertedWithCustomError(comet, 'TokenIsDeactivated').withArgs(collateralToken.address);
        });
      });
    });
  });
});
