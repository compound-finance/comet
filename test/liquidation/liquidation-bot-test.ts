import { event, expect, exp, wait } from '../helpers';
import { ethers } from 'hardhat';
import { Exchange, forkMainnet, makeProtocol, makeLiquidatableProtocol, resetHardhatNetwork } from './makeLiquidatableProtocol';
import { DAI, SUSHISWAP_ROUTER, UNISWAP_ROUTER } from './addresses';

describe('Liquidator', function () {
  beforeEach(forkMainnet);
  afterEach(resetHardhatNetwork);

  it('Should init liquidator', async function () {
    const { comet, liquidator } = await makeLiquidatableProtocol();
    expect(await liquidator.uniswapRouter()).to.equal(UNISWAP_ROUTER);
    expect(await liquidator.sushiSwapRouter()).to.equal(SUSHISWAP_ROUTER);
    expect(await liquidator.comet()).to.equal(comet.address);
  });

  it('Should execute DAI flash swap with profit', async () => {
    const { comet, liquidator, users: [owner, underwater, recipient], assets: { dai, usdc } } = await makeLiquidatableProtocol();
    // underwater user approves Comet
    await dai.connect(underwater).approve(comet.address, exp(120, 18));
    // underwater user supplies DAI to Comet
    await comet.connect(underwater).supply(dai.address, exp(120, 18));
    // artificially put in an underwater borrow position
    await comet.setBasePrincipal(underwater.address, -(exp(200, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(recipient.address);
    const tx = await wait(liquidator.connect(owner).initFlash({
      accounts: [underwater.address],
      pairToken: ethers.utils.getAddress(dai.address),
      poolFee: 100,
    }));


    expect(tx.hash).to.be.not.null;
    const afterUSDCBalance = await usdc.balanceOf(recipient.address);
    const profit = afterUSDCBalance - beforeUSDCBalance;
    expect(tx.hash).to.be.not.null;
    expect(profit).to.be.greaterThan(0);
    expect(event(tx, 2)).to.deep.equal({
      Absorb: {
        initiator: owner.address,
        accounts: [ underwater.address ]
      }
    });
  });

  it('Should execute WETH flash swap with profit', async () => {
    const { comet, liquidator, users: [owner, underwater, recipient], assets: { usdc, weth } } = await makeLiquidatableProtocol();
    await weth.connect(underwater).approve(comet.address, exp(120, 18));
    await comet.connect(underwater).supply(weth.address, exp(120, 18));
    await comet.setBasePrincipal(underwater.address, -(exp(4000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(recipient.address);
    const tx = await wait(liquidator.connect(owner).initFlash({
      accounts: [underwater.address],
      pairToken: ethers.utils.getAddress(DAI),
      poolFee: 100
    }));

    const afterUSDCBalance = await usdc.balanceOf(recipient.address);
    const profit = afterUSDCBalance - beforeUSDCBalance;
    expect(tx.hash).to.be.not.null;
    expect(profit).to.be.greaterThan(0);
    expect(event(tx, 2)).to.deep.equal({
      Absorb: {
        initiator: owner.address,
        accounts: [ underwater.address ]
      }
    });
  });

  it('Should execute WBTC flash swap with profit', async () => {
    const { comet, liquidator, users: [owner, underwater, recipient], assets: { usdc, wbtc } } = await makeLiquidatableProtocol();
    await wbtc.connect(underwater).approve(comet.address, exp(2, 8));
    await comet.connect(underwater).supply(wbtc.address, exp(2, 8));
    await comet.setBasePrincipal(underwater.address, -(exp(40000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(recipient.address);
    const tx = await wait(liquidator.connect(owner).initFlash({
      accounts: [underwater.address],
      pairToken: ethers.utils.getAddress(DAI),
      poolFee: 100
    }));

    const afterUSDCBalance = await usdc.balanceOf(recipient.address);
    const profit = afterUSDCBalance - beforeUSDCBalance;
    expect(tx.hash).to.be.not.null;
    expect(profit).to.be.greaterThan(0);
    expect(event(tx, 2)).to.deep.equal({
      Absorb: {
        initiator: owner.address,
        accounts: [ underwater.address ]
      }
    });
  });

  it('Should execute UNI flash swap with profit', async () => {
    const { comet, liquidator, users: [owner, underwater, recipient], assets: { usdc, uni } } = await makeLiquidatableProtocol();
    await uni.connect(underwater).approve(comet.address, exp(120, 18));
    await comet.connect(underwater).supply(uni.address, exp(120, 18));
    await comet.setBasePrincipal(underwater.address, -(exp(40000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(recipient.address);
    const tx = await wait(liquidator.connect(owner).initFlash({
      accounts: [underwater.address],
      pairToken: ethers.utils.getAddress(DAI),
      poolFee: 100,
    }));

    const afterUSDCBalance = await usdc.balanceOf(recipient.address);
    const profit = afterUSDCBalance - beforeUSDCBalance;
    expect(tx.hash).to.be.not.null;
    expect(profit).to.be.greaterThan(0);
    expect(event(tx, 2)).to.deep.equal({
      Absorb: {
        initiator: owner.address,
        accounts: [ underwater.address ]
      }
    });
  });

  it('Should execute COMP flash swap with profit', async () => {
    const { comet, liquidator, users: [owner, underwater, recipient], assets: { usdc, comp } } = await makeLiquidatableProtocol();
    await comp.connect(underwater).approve(comet.address, exp(12, 18));
    await comet.connect(underwater).supply(comp.address, exp(12, 18));
    await comet.setBasePrincipal(underwater.address, -(exp(40000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(recipient.address);
    const tx = await wait(liquidator.connect(owner).initFlash({
      accounts: [underwater.address],
      pairToken: ethers.utils.getAddress(DAI),
      poolFee: 100,
    }));

    const afterUSDCBalance = await usdc.balanceOf(recipient.address);
    const profit = afterUSDCBalance - beforeUSDCBalance;
    expect(tx.hash).to.be.not.null;
    expect(profit).to.be.greaterThan(0);
    expect(event(tx, 2)).to.deep.equal({
      Absorb: {
        initiator: owner.address,
        accounts: [ underwater.address ]
      }
    });
  });

  it('Should execute LINK flash swap with profit', async () => {
    const { comet, liquidator, users: [owner, underwater, recipient], assets: { usdc, link } } = await makeLiquidatableProtocol();
    await link.connect(underwater).approve(comet.address, exp(12, 18));
    await comet.connect(underwater).supply(link.address, exp(12, 18));
    await comet.setBasePrincipal(underwater.address, -(exp(4000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(recipient.address);
    const tx = await wait(liquidator.connect(owner).initFlash({
      accounts: [underwater.address],
      pairToken: ethers.utils.getAddress(DAI),
      poolFee: 100
    }));

    const afterUSDCBalance = await usdc.balanceOf(recipient.address);
    const profit = afterUSDCBalance - beforeUSDCBalance;
    expect(tx.hash).to.be.not.null;
    expect(profit).to.be.greaterThan(0);
    expect(event(tx, 2)).to.deep.equal({
      Absorb: {
        initiator: owner.address,
        accounts: [ underwater.address ]
      }
    });
  });

  it('sets admin to the deployer', async () => {
    const { liquidator, users: [signer] } = await makeLiquidatableProtocol();
    expect(await liquidator.admin()).to.eq(signer.address);
  });

  it('setLiquidationThreshold reverts if called by non-admin', async () => {
    const { liquidator, users: [_signer, underwater] } = await makeLiquidatableProtocol();
    await expect(
      liquidator.connect(underwater).setLiquidationThreshold(10)
    ).to.be.revertedWith("custom error 'Unauthorized()'");
  });

  it('setLiquidationThreshold updates the liquidation threshold', async () => {
    const { liquidator, users: [signer] } = await makeLiquidatableProtocol();

    expect(await liquidator.liquidationThreshold()).to.eq(10e6);

    await liquidator.connect(signer).setLiquidationThreshold(50e6);

    expect(await liquidator.liquidationThreshold()).to.eq(50e6);
  });

  it('setPoolConfigs reverts if called by non-admin', async () => {
    const { liquidator, users: [_signer, underwater] } = await makeLiquidatableProtocol();

    await expect(
      liquidator.connect(underwater).setPoolConfigs([], [], [], [], [])
    ).to.be.revertedWith("custom error 'Unauthorized()'");
  });

  it('setPoolConfigs updates pool configs', async () => {
    const { liquidator, users: [signer] } = await makeLiquidatableProtocol();

    const wethAddress = await liquidator.connect(signer).weth();
    const poolConfig = await liquidator.connect(signer).poolConfigs(wethAddress);

    const newPoolConfig = {
      isLowLiquidity: !poolConfig.isLowLiquidity,
      fee: poolConfig.fee * 2,
      exchange: poolConfig.exchange === Exchange.Uniswap ? Exchange.SushiSwap : Exchange.Uniswap,
      maxCollateralToPurchase: poolConfig.maxCollateralToPurchase.div(2)
    };

    await liquidator.connect(signer).setPoolConfigs(
      [wethAddress],
      [newPoolConfig.isLowLiquidity],
      [newPoolConfig.fee],
      [newPoolConfig.exchange],
      [newPoolConfig.maxCollateralToPurchase]
    );

    const updatedPoolConfig = await liquidator.connect(signer).poolConfigs(wethAddress);

    expect(updatedPoolConfig.isLowLiquidity).to.eq(newPoolConfig.isLowLiquidity);
    expect(updatedPoolConfig.fee).to.eq(newPoolConfig.fee);
    expect(updatedPoolConfig.exchange).to.eq(newPoolConfig.exchange);
    expect(updatedPoolConfig.maxCollateralToPurchase).to.eq(newPoolConfig.maxCollateralToPurchase);
  });

  describe('hasPurchasableCollateral', async () => {
    it('is false when there are no assets for sale', async () => {
      const { liquidator } = await makeLiquidatableProtocol();

      expect(await liquidator.hasPurchasableCollateral()).to.be.false;
    });

    it('is true when are collateral is available for purchase', async () => {
      const {
        comet,
        liquidator,
        assets: { weth },
        whales: { wethWhale }
      } = await makeProtocol();

      expect(await liquidator.hasPurchasableCollateral()).to.be.false;

      await weth.connect(wethWhale).transfer(comet.address, exp(100, 18));

      expect(await liquidator.hasPurchasableCollateral()).to.be.true;
    });

    // uses the liquidation threshold
    it('uses liquidation threshold to determine if there is a sufficient amount of collateral to purchase', async () => {
      const {
        comet,
        liquidator,
        users: [signer],
        assets: { comp },
        whales: { compWhale }
      } = await makeProtocol();

      await liquidator.connect(signer).setLiquidationThreshold(100e6);

      // is false initially
      expect(await liquidator.hasPurchasableCollateral()).to.be.false;

      // comet has 1 COMP for sale
      await comp.connect(compWhale).transfer(comet.address, exp(1,18));

      // but is still below the liquidation threshold
      expect(await liquidator.hasPurchasableCollateral()).to.be.false;

      await liquidator.connect(signer).setLiquidationThreshold(5e6);

      expect(await liquidator.hasPurchasableCollateral()).to.be.true;
    });
  });
});

// XXX test that contracts reverts if pool config doesn't exist