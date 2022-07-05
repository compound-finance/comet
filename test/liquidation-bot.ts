import { event, expect, exp, factor, defaultAssets, makeProtocol, mulPrice, portfolio, wait, setTotalsBasic } from './helpers';

import hre, { ethers } from 'hardhat';
import { HttpNetworkConfig } from 'hardhat/types/config';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  CometExt,
  CometExt__factory,
  CometHarness,
  CometHarness__factory,
  CometHarnessInterface,
  CometHarnessInterface__factory,
  Liquidator,
  Liquidator__factory
} from '../build/types';

import daiAbi from './dai-abi';
import usdcAbi from './usdc-abi';

// mainnet
// export const DAI_WHALE = "0x6b175474e89094c44da98b954eedeac495271d0f";
export const DAI_WHALE = '0x7a8edc710ddeadddb0b539de83f3a306a621e823';
export const USDC_WHALE = '0xA929022c9107643515F5c777cE9a910F0D1e490C';
export const WETH_WHALE = '0x0F4ee9631f4be0a63756515141281A3E2B293Bbe';
export const WBTC = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599';
export const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
export const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
export const COMP = '0xc00e94cb662c3520282e6f5717214004a7f26888';
export const LINK = '0x514910771AF9Ca656af840dff83E8264EcF986CA';
export const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
export const UNI = '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984';
export const WETH9 = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

export const swapRouter = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
export const uniswapv3factory = '0x1F98431c8aD98523631AE4a59f267346ea31F984';

// Chainlink mainnet price feeds
const DAI_USDC_PRICE_FEED = '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9';
const USDC_USD_PRICE_FEED = '0x8fffffd4afb6115b954bd326cbe7b4ba576818f6';
const ETH_USDC_PRICE_FEED = '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419';
const WBTC_USDC_PRICE_FEED = '0xf4030086522a5beea4988f8ca5b36dbc97bee88c';
const COMP_USDC_PRICE_FEED = '0xdbd020caef83efd542f4de03e3cf0c28a4428bd5';
const LINK_USDC_PRICE_FEED = '0x2c1d072e956affc0d435cb7ac38ef18d24d9127c';
const UNI_USDC_PRICE_FEED = '0x553303d460ee0afb37edff9be42922d8ff63220e';

async function makeProtocolAlt() {
  const CometExtFactory = (await ethers.getContractFactory('CometExt')) as CometExt__factory;
  const symbol32 = ethers.utils.formatBytes32String('📈BASE');
  const extensionDelegate = await CometExtFactory.deploy({ symbol32 });
  await extensionDelegate.deployed();

  const CometFactory = (await ethers.getContractFactory('CometHarness')) as CometHarness__factory;
  const config = {
    governor: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    pauseGuardian: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    extensionDelegate: extensionDelegate.address,
    baseToken: USDC,
    baseTokenPriceFeed: USDC_USD_PRICE_FEED,
    kink: 800000000000000000n,
    perYearInterestRateBase: 5000000000000000n,
    perYearInterestRateSlopeLow: 100000000000000000n,
    perYearInterestRateSlopeHigh: 3000000000000000000n,
    reserveRate: 100000000000000000n,
    storeFrontPriceFactor: 1000000000000000000n,
    trackingIndexScale: 1000000000000000n,
    baseTrackingSupplySpeed: 1000000000000000n,
    baseTrackingBorrowSpeed: 1000000000000000n,
    baseMinForRewards: 1000000n,
    baseBorrowMin: 1000000n,
    targetReserves: 1000000000000000000n,
    assetConfigs: [
      {
        asset: DAI,
        priceFeed: DAI_USDC_PRICE_FEED,
        decimals: 18,
        borrowCollateralFactor: 999999999999999999n,
        liquidateCollateralFactor: 1000000000000000000n,
        liquidationFactor: 900000000000000000n,
        supplyCap: 1000000000000000000000000n
      },
      {
        asset: COMP,
        priceFeed: COMP_USDC_PRICE_FEED,
        decimals: 18,
        borrowCollateralFactor: 999999999999999999n,
        liquidateCollateralFactor: 1000000000000000000n,
        liquidationFactor: 900000000000000000n,
        supplyCap: 100000000000000000000n
      },
      {
        asset: WBTC,
        priceFeed: WBTC_USDC_PRICE_FEED,
        decimals: 8,
        borrowCollateralFactor: 999999999999999999n,
        liquidateCollateralFactor: 1000000000000000000n,
        liquidationFactor: 900000000000000000n,
        supplyCap: 1000000000000000000000000n
      },
      {
        asset: WETH9,
        priceFeed: ETH_USDC_PRICE_FEED,
        decimals: 18,
        borrowCollateralFactor: 999999999999999999n,
        liquidateCollateralFactor: 1000000000000000000n,
        liquidationFactor: 900000000000000000n,
        supplyCap: 1000000000000000000000000n
      },
      {
        asset: LINK,
        priceFeed: LINK_USDC_PRICE_FEED,
        decimals: 18,
        borrowCollateralFactor: 999999999999999999n,
        liquidateCollateralFactor: 1000000000000000000n,
        liquidationFactor: 900000000000000000n,
        supplyCap: 1000000000000000000000000n
      },
      {
        asset: UNI,
        priceFeed: UNI_USDC_PRICE_FEED,
        decimals: 18,
        borrowCollateralFactor: 999999999999999999n,
        liquidateCollateralFactor: 1000000000000000000n,
        liquidationFactor: 900000000000000000n,
        supplyCap: 1000000000000000000000000n
      },
    ]
  };

  const comet = await CometFactory.deploy(config);
  await comet.deployed();
  console.log(`comet.address: ${comet.address}`);
  const cometHarnessInterface = await ethers.getContractAt('CometHarnessInterface', comet.address) as CometHarnessInterface;
  return cometHarnessInterface;
}

describe.only('Liquidator', function () {
  let comet: CometHarnessInterface;
  let liquidator: Liquidator;

  let owner: SignerWithAddress;
  let addr1: SignerWithAddress;
  let addrs: SignerWithAddress[];

  before(async () => {
    const mainnetConfig = hre.config.networks.mainnet as HttpNetworkConfig;
    // fork from mainnet to make use of real Uniswap pools
    await ethers.provider.send(
      "hardhat_reset",
      [
        {
          forking: {
            jsonRpcUrl: mainnetConfig.url,
          },
        },
      ],
    );

    [owner, addr1, ...addrs] = await ethers.getSigners();
    // Deploy comet
    comet = await makeProtocolAlt();

    // Deploy liquidator
    const Liquidator = await ethers.getContractFactory('Liquidator') as Liquidator__factory;
    liquidator = await Liquidator.deploy(
      ethers.utils.getAddress(swapRouter),
      ethers.utils.getAddress(comet.address),
      ethers.utils.getAddress(uniswapv3factory),
      ethers.utils.getAddress(WETH9),
      [ethers.utils.getAddress(DAI), ethers.utils.getAddress(COMP)],
      [100, 500]
    );
    await liquidator.deployed();
  });

  after(async () => {
    // reset to blank hardhat network
    await ethers.provider.send('hardhat_reset', []);
  });

  it('Should init liquidator', async function () {
    expect(await liquidator.swapRouter()).to.equal(swapRouter);
  });

  it('Should execute DAI flash swap', async () => {
  // Set underwater account
    await setTotalsBasic(comet, {
      baseBorrowIndex: 2e15,
      baseSupplyIndex: 2e15,
      totalSupplyBase: 20000000000000n,
      totalBorrowBase: 20000000000000n
    });

    console.log(`owner.address: ${owner.address}`);
    console.log(`liquidator.address: ${liquidator.address}`);

    const mockDai = new ethers.Contract(DAI, daiAbi, owner);
    const mockUSDC = new ethers.Contract(USDC, usdcAbi, owner);

    console.log(`mockUsdc.balanceOf(liquidator.address): ${await mockUSDC.balanceOf(liquidator.address)}`);

    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [DAI_WHALE],
    });
    let daiWhaleSigner = await ethers.getSigner(DAI_WHALE);

    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [USDC_WHALE],
    });
    let usdcWhaleSigner = await ethers.getSigner(USDC_WHALE);

    await mockDai.connect(daiWhaleSigner).transfer(comet.address, 200000000000000000000n);
    await mockUSDC.connect(usdcWhaleSigner).transfer(owner.address, 300000000n); // 300e6

    console.log('transferring dai to addr1');
    console.log(`await mockDai.balanceOf(daiWhaleSigner.address): ${await mockDai.balanceOf(daiWhaleSigner.address)}`);
    // await comet.setCollateralBalance(addr1.address, DAI, exp(120, 18));
    await mockDai.connect(daiWhaleSigner).transfer(addr1.address, 200000000000000000000n);
    await mockDai.connect(addr1).approve(comet.address, 120000000000000000000n);
    await comet.connect(addr1).supply(DAI, 120000000000000000000n); //
    await comet.setBasePrincipal(addr1.address, -(exp(200, 6)));

    console.log(`BEFORE mockUSDC.balanceOf(owner.address): ${await mockUSDC.balanceOf(owner.address)}`);

    const tx = await liquidator.connect(owner).initFlash({
      // XXX add accounts
      accounts: [addr1.address],
      pairToken: ethers.utils.getAddress(DAI),
      poolFee: 500,
      reversedPair: false,
    });

    console.log(`AFTER mockUSDC.balanceOf(owner.address): ${await mockUSDC.balanceOf(owner.address)}`);

    expect(tx.hash).to.be.not.null;
  });
});
