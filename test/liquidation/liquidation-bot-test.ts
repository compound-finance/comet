import { event, expect, exp, wait } from '../helpers';
import { ethers } from 'hardhat';
import { Exchange, forkMainnet, makeLiquidatableProtocol, resetHardhatNetwork } from './makeLiquidatableProtocol';
import { DAI, SUSHISWAP_ROUTER, UNISWAP_ROUTER } from './addresses';

describe('Liquidator', function () {
  before(forkMainnet);
  after(resetHardhatNetwork);

  it('Should init liquidator', async function () {
    const { liquidator } = await makeLiquidatableProtocol();
    expect(await liquidator.uniswapRouter()).to.equal(UNISWAP_ROUTER);
    expect(await liquidator.sushiSwapRouter()).to.equal(SUSHISWAP_ROUTER);
  });

  it('Should execute WETH flash swap with profit', async () => {
    const { comet, liquidator, users: [owner, underwater], assets: { usdc, weth } } = await makeLiquidatableProtocol();
    await weth.connect(underwater).approve(comet.address, exp(120, 18));
    await comet.connect(underwater).supply(weth.address, exp(120, 18));
    await comet.setBasePrincipal(underwater.address, -(exp(4000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(owner.address);

    const tx = await wait(liquidator.connect(owner).absorbAndArbitrage(
      comet.address,
      [underwater.address],
      [weth.address],
      [
        {
          exchange: Exchange.Uniswap,
          uniswapPoolFee: 500,
          swapViaWeth: false,
          balancerPoolId: ethers.utils.formatBytes32String(''),
          curvePool: ethers.constants.AddressZero
        }
      ],
      [ethers.constants.MaxUint256],
      DAI,
      100,
      10e6
    ));

    const afterUSDCBalance = await usdc.balanceOf(owner.address);
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
    const { comet, liquidator, users: [owner, underwater], assets: { usdc, wbtc } } = await makeLiquidatableProtocol();
    await wbtc.connect(underwater).approve(comet.address, exp(2, 8));
    await comet.connect(underwater).supply(wbtc.address, exp(2, 8));
    await comet.setBasePrincipal(underwater.address, -(exp(40000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(owner.address);
    const tx = await wait(liquidator.connect(owner).absorbAndArbitrage(
      comet.address,
      [underwater.address],
      [wbtc.address],
      [
        {
          exchange: Exchange.Uniswap,
          uniswapPoolFee: 3000,
          swapViaWeth: true,
          balancerPoolId: ethers.utils.formatBytes32String(''),
          curvePool: ethers.constants.AddressZero
        }
      ],
      [ethers.constants.MaxUint256],
      DAI,
      100,
      10e6
    ));

    const afterUSDCBalance = await usdc.balanceOf(owner.address);
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
    const { comet, liquidator, users: [owner, underwater], assets: { usdc, uni } } = await makeLiquidatableProtocol();
    await uni.connect(underwater).approve(comet.address, exp(120, 18));
    await comet.connect(underwater).supply(uni.address, exp(120, 18));
    await comet.setBasePrincipal(underwater.address, -(exp(40000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(owner.address);
    const tx = await wait(liquidator.connect(owner).absorbAndArbitrage(
      comet.address,
      [underwater.address],
      [uni.address],
      [
        {
          exchange: Exchange.Uniswap,
          uniswapPoolFee: 3000,
          swapViaWeth: true,
          balancerPoolId: ethers.utils.formatBytes32String(''),
          curvePool: ethers.constants.AddressZero
        }
      ],
      [ethers.constants.MaxUint256],
      DAI,
      100,
      10e6
    ));

    const afterUSDCBalance = await usdc.balanceOf(owner.address);
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
    const { comet, liquidator, users: [owner, underwater], assets: { usdc, comp } } = await makeLiquidatableProtocol();
    await comp.connect(underwater).approve(comet.address, exp(12, 18));
    await comet.connect(underwater).supply(comp.address, exp(12, 18));
    await comet.setBasePrincipal(underwater.address, -(exp(40000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(owner.address);
    const tx = await wait(liquidator.connect(owner).absorbAndArbitrage(
      comet.address,
      [underwater.address],
      [comp.address],
      [
        {
          exchange: Exchange.Uniswap,
          uniswapPoolFee: 3000,
          swapViaWeth: true,
          balancerPoolId: ethers.utils.formatBytes32String(''),
          curvePool: ethers.constants.AddressZero
        }
      ],
      [ethers.constants.MaxUint256],
      DAI,
      100,
      10e6
    ));

    const afterUSDCBalance = await usdc.balanceOf(owner.address);
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
    const { comet, liquidator, users: [owner, underwater], assets: { usdc, link } } = await makeLiquidatableProtocol();
    await link.connect(underwater).approve(comet.address, exp(12, 18));
    await comet.connect(underwater).supply(link.address, exp(12, 18));
    await comet.setBasePrincipal(underwater.address, -(exp(4000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(owner.address);
    const tx = await wait(liquidator.connect(owner).absorbAndArbitrage(
      comet.address,
      [underwater.address],
      [link.address],
      [
        {
          exchange: Exchange.Uniswap,
          uniswapPoolFee: 3000,
          swapViaWeth: true,
          balancerPoolId: ethers.utils.formatBytes32String(''),
          curvePool: ethers.constants.AddressZero
        }
      ],
      [ethers.constants.MaxUint256],
      DAI,
      100,
      10e6
    ));

    const afterUSDCBalance = await usdc.balanceOf(owner.address);
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
});
