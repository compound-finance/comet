import { event, expect, exp, wait } from '../helpers';
import { ethers } from 'hardhat';
import { forkMainnet, makeLiquidatableProtocol, resetHardhatNetwork } from './makeLiquidatableProtocol';
import { getSwapInfo } from '../../scripts/liquidation_bot/liquidateUnderwaterBorrowers';

describe('LiquidatorV2', function () {
  before(forkMainnet);
  after(resetHardhatNetwork);

  it('Should execute DAI flash swap with profit', async () => {
    const { comet, liquidatorV2, users: [owner, underwater, recipient], assets: { dai, usdc } } = await makeLiquidatableProtocol();
    // underwater user approves Comet
    await dai.connect(underwater).approve(comet.address, exp(120, 18));
    // underwater user supplies DAI to Comet
    await comet.connect(underwater).supply(dai.address, exp(120, 18));
    // artificially put in an underwater borrow position
    await comet.setBasePrincipal(underwater.address, -(exp(200, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(recipient.address);

    const {
      swapAssets,
      swapTargets,
      swapCallDatas
    } = await getSwapInfo(comet, liquidatorV2, [underwater.address]);

    const tx = await wait(
      liquidatorV2.connect(owner).absorbAndArbitrage(
        comet.address,
        [underwater.address],
        swapAssets,
        swapTargets,
        swapCallDatas,
        ethers.utils.getAddress(dai.address),
        100
      )
    );

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
    const { comet, liquidatorV2, users: [owner, underwater, recipient], assets: { dai, usdc, weth } } = await makeLiquidatableProtocol();
    await weth.connect(underwater).approve(comet.address, exp(120, 18));
    await comet.connect(underwater).supply(weth.address, exp(120, 18));
    await comet.setBasePrincipal(underwater.address, -(exp(4000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(recipient.address);

    const {
      swapAssets,
      swapTargets,
      swapCallDatas
    } = await getSwapInfo(comet, liquidatorV2, [underwater.address]);

    const tx = await wait(
      liquidatorV2.connect(owner).absorbAndArbitrage(
        comet.address,
        [underwater.address],
        swapAssets,
        swapTargets,
        swapCallDatas,
        ethers.utils.getAddress(dai.address),
        100
      )
    );

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
    const { comet, liquidatorV2, users: [owner, underwater, recipient], assets: { dai, usdc, wbtc } } = await makeLiquidatableProtocol();
    await wbtc.connect(underwater).approve(comet.address, exp(2, 8));
    await comet.connect(underwater).supply(wbtc.address, exp(2, 8));
    await comet.setBasePrincipal(underwater.address, -(exp(40000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(recipient.address);

    const {
      swapAssets,
      swapTargets,
      swapCallDatas
    } = await getSwapInfo(comet, liquidatorV2, [underwater.address]);

    const tx = await wait(
      liquidatorV2.connect(owner).absorbAndArbitrage(
        comet.address,
        [underwater.address],
        swapAssets,
        swapTargets,
        swapCallDatas,
        ethers.utils.getAddress(dai.address),
        100
      )
    );

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
    const { comet, liquidatorV2, users: [owner, underwater, recipient], assets: { dai, usdc, uni } } = await makeLiquidatableProtocol();
    await uni.connect(underwater).approve(comet.address, exp(120, 18));
    await comet.connect(underwater).supply(uni.address, exp(120, 18));
    await comet.setBasePrincipal(underwater.address, -(exp(40000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(recipient.address);

    const {
      swapAssets,
      swapTargets,
      swapCallDatas
    } = await getSwapInfo(comet, liquidatorV2, [underwater.address]);

    const tx = await wait(
      liquidatorV2.connect(owner).absorbAndArbitrage(
        comet.address,
        [underwater.address],
        swapAssets,
        swapTargets,
        swapCallDatas,
        ethers.utils.getAddress(dai.address),
        100
      )
    );

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
    const { comet, liquidatorV2, users: [owner, underwater, recipient], assets: { dai, usdc, comp } } = await makeLiquidatableProtocol();
    await comp.connect(underwater).approve(comet.address, exp(12, 18));
    await comet.connect(underwater).supply(comp.address, exp(12, 18));
    await comet.setBasePrincipal(underwater.address, -(exp(40000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(recipient.address);

    const {
      swapAssets,
      swapTargets,
      swapCallDatas
    } = await getSwapInfo(comet, liquidatorV2, [underwater.address]);

    const tx = await wait(
      liquidatorV2.connect(owner).absorbAndArbitrage(
        comet.address,
        [underwater.address],
        swapAssets,
        swapTargets,
        swapCallDatas,
        ethers.utils.getAddress(dai.address),
        100
      )
    );

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
    const { comet, liquidatorV2, users: [owner, underwater, recipient], assets: { dai, usdc, link } } = await makeLiquidatableProtocol();
    await link.connect(underwater).approve(comet.address, exp(12, 18));
    await comet.connect(underwater).supply(link.address, exp(12, 18));
    await comet.setBasePrincipal(underwater.address, -(exp(4000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(recipient.address);

    const {
      swapAssets,
      swapTargets,
      swapCallDatas
    } = await getSwapInfo(comet, liquidatorV2, [underwater.address]);

    const tx = await wait(
      liquidatorV2.connect(owner).absorbAndArbitrage(
        comet.address,
        [underwater.address],
        swapAssets,
        swapTargets,
        swapCallDatas,
        ethers.utils.getAddress(dai.address),
        100
      )
    );

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
    const { liquidatorV2, users: [signer] } = await makeLiquidatableProtocol();
    expect(await liquidatorV2.admin()).to.eq(signer.address);
  });

  it('setAssetConfig reverts if called by non-admin', async () => {
    const { comet, liquidatorV2, users: [_signer, underwater], assets: { link } } = await makeLiquidatableProtocol();

    await expect(
      liquidatorV2.connect(underwater).setAssetConfig(comet.address, link.address, exp(150, 18), true)
    ).to.be.revertedWith("custom error 'Unauthorized()'");
  });

  it('setAssetConfig updates asset config', async () => {
    const { comet, liquidatorV2, users: [signer], assets: { link } } = await makeLiquidatableProtocol();

    const assetConfig = await liquidatorV2.connect(signer).assetConfigs(comet.address, link.address);

    expect(assetConfig.maxCollateralToPurchase).to.eq(0);
    expect(assetConfig.isSet).to.be.false;

    await liquidatorV2.connect(signer).setAssetConfig(
      comet.address,
      link.address,
      exp(250, 18),
      true
    );

    const updatedAssetConfig = await liquidatorV2.connect(signer).assetConfigs(comet.address, link.address);

    expect(updatedAssetConfig.maxCollateralToPurchase).to.eq(exp(250,18));
    expect(updatedAssetConfig.isSet).to.be.true;
  });
});

