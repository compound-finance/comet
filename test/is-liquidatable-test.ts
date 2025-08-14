import { expect, exp, makeProtocol, makeConfigurator } from './helpers';
import { ethers } from 'hardhat';

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
  

  it('cannot liquidate if price is 0', async () => {
    const {
      comet,
      cometProxy,
      tokens,
      configurator,
      configuratorProxy,
      proxyAdmin,
      users: [alice],
    } = await makeConfigurator({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
        },
      },
    });
    const cometAsProxy = comet.attach(cometProxy.address);
    const configuratorAsProxy = configurator.attach(configuratorProxy.address);
    const { COMP } = tokens;

    // user owes $100,000
    await cometAsProxy.setBasePrincipal(alice.address, -100_000_000_000);
    expect(await cometAsProxy.isLiquidatable(alice.address)).to.be.true;
    const revertPriceFeedFactory = await ethers.getContractFactory('RevertPriceFeed');
    const revertPriceFeed = await revertPriceFeedFactory.deploy(
      8,
      1
    );
    await revertPriceFeed.deployed();
    console.log('revertPriceFeed deployed:');

    await configuratorAsProxy.updateAssetPriceFeed(cometAsProxy.address, COMP.address, revertPriceFeed.address);
    console.log('updated asset price feed');
    await proxyAdmin.deployAndUpgradeTo(configuratorAsProxy.address, cometAsProxy.address);
    console.log('upgraded comet to configurator proxy');
    expect(await cometAsProxy.isLiquidatable(alice.address)).to.be.true;
    console.log('position is liquidatable');
    await revertPriceFeed.setToRevert(true);
    await COMP.allocateTo(alice.address, 1);
    await COMP.connect(alice).approve(cometAsProxy.address, 1);
    await cometAsProxy.connect(alice).supply(COMP.address, 1);
    console.log('successfully supplied 1 wei of COMP');
    await expect(cometAsProxy.isLiquidatable(alice.address)).to.be.reverted;
    console.log('position cannot be liquidated');
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
      0,           // roundId
      exp(0.5, 8), // answer
      0,           // startedAt
      0,           // updatedAt
      0            // answeredInRound
    );

    expect(await comet.isLiquidatable(alice.address)).to.be.true;
  });
});
