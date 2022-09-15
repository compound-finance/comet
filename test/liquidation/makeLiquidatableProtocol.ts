import hre, { ethers } from 'hardhat';
import { exp, setTotalsBasic } from '../helpers';
import { HttpNetworkConfig } from 'hardhat/types/config';
import {
  CometExt__factory,
  CometHarness__factory,
  CometHarnessInterface,
  Liquidator__factory
} from '../../build/types';
import {
  COMP,
  COMP_USDC_PRICE_FEED,
  COMP_WHALE,
  DAI,
  DAI_USDC_PRICE_FEED,
  DAI_WHALE,
  LINK,
  LINK_USDC_PRICE_FEED,
  LINK_WHALE,
  SWAP_ROUTER,
  UNI,
  UNI_USDC_PRICE_FEED,
  UNI_WHALE,
  USDC,
  USDC_USD_PRICE_FEED,
  USDC_WHALE,
  WBTC,
  WBTC_USDC_PRICE_FEED,
  WBTC_WHALE,
  WETH9,
  ETH_USDC_PRICE_FEED,
  WETH_WHALE,
  UNISWAP_V3_FACTORY
} from './addresses';
import daiAbi from './dai-abi';
import usdcAbi from './usdc-abi';
import wethAbi from './weth-abi';
import wbtcAbi from './wbtc-abi';
import uniAbi from './uni-abi';
import compAbi from './comp-abi';
import linkAbi from './link-abi';

export default async function makeLiquidatableProtocol() {
  // build Comet
  const CometExtFactory = (await ethers.getContractFactory('CometExt')) as CometExt__factory;
  const name32 = ethers.utils.formatBytes32String('Compound Comet');
  const symbol32 = ethers.utils.formatBytes32String('📈BASE');
  const extensionDelegate = await CometExtFactory.deploy({ name32, symbol32 });
  await extensionDelegate.deployed();

  const CometFactory = (await ethers.getContractFactory('CometHarness')) as CometHarness__factory;
  const config = {
    governor: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    pauseGuardian: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    extensionDelegate: extensionDelegate.address,
    baseToken: USDC,
    baseTokenPriceFeed: USDC_USD_PRICE_FEED,
    supplyKink: exp(0.8, 18),
    supplyPerYearInterestRateBase: 0n,
    supplyPerYearInterestRateSlopeLow: exp(0.05, 18),
    supplyPerYearInterestRateSlopeHigh: exp(2, 18),
    borrowKink: exp(0.8, 18),
    borrowPerYearInterestRateBase: exp(0.005, 18),
    borrowPerYearInterestRateSlopeLow: exp(0.1, 18),
    borrowPerYearInterestRateSlopeHigh: exp(3, 18),
    storeFrontPriceFactor: exp(1, 18),
    trackingIndexScale: exp(1, 15),
    baseTrackingSupplySpeed: exp(1, 15),
    baseTrackingBorrowSpeed: exp(1, 15),
    baseMinForRewards: exp(1, 6),
    baseBorrowMin: exp(1, 6),
    targetReserves: exp(1, 18),
    assetConfigs: [
      {
        asset: DAI,
        priceFeed: DAI_USDC_PRICE_FEED,
        decimals: 18,
        borrowCollateralFactor: 999999999999999999n,
        liquidateCollateralFactor: exp(1, 18),
        liquidationFactor: exp(0.9, 18),
        supplyCap: exp(1000000, 18)
      },
      {
        asset: COMP,
        priceFeed: COMP_USDC_PRICE_FEED,
        decimals: 18,
        borrowCollateralFactor: 999999999999999999n,
        liquidateCollateralFactor: exp(1, 18),
        liquidationFactor: exp(0.9, 18),
        supplyCap: exp(100, 18)
      },
      {
        asset: WBTC,
        priceFeed: WBTC_USDC_PRICE_FEED,
        decimals: 8,
        borrowCollateralFactor: 999999999999999999n,
        liquidateCollateralFactor: exp(1, 18),
        liquidationFactor: exp(0.9, 18),
        supplyCap: exp(1000, 8)
      },
      {
        asset: WETH9,
        priceFeed: ETH_USDC_PRICE_FEED,
        decimals: 18,
        borrowCollateralFactor: 999999999999999999n,
        liquidateCollateralFactor: exp(1, 18),
        liquidationFactor: exp(0.9, 18),
        supplyCap: exp(1000000, 18)
      },
      {
        asset: LINK,
        priceFeed: LINK_USDC_PRICE_FEED,
        decimals: 18,
        borrowCollateralFactor: 999999999999999999n,
        liquidateCollateralFactor: exp(1, 18),
        liquidationFactor: exp(0.9, 18),
        supplyCap: exp(1000000, 18)
      },
      {
        asset: UNI,
        priceFeed: UNI_USDC_PRICE_FEED,
        decimals: 18,
        borrowCollateralFactor: 999999999999999999n,
        liquidateCollateralFactor: exp(1, 18),
        liquidationFactor: exp(0.9, 18),
        supplyCap: exp(1000000, 18)
      },
    ]
  };

  const comet = await CometFactory.deploy(config);
  await comet.deployed();
  const cometHarnessInterface = await ethers.getContractAt('CometHarnessInterface', comet.address) as CometHarnessInterface;

  // configure Comet
  await setTotalsBasic(cometHarnessInterface, {
    baseBorrowIndex: 2e15,
    baseSupplyIndex: 2e15,
    totalSupplyBase: 2e13,
    totalBorrowBase: 2e13
  });

  // create underwater user
  const [signer, underwaterUser, recipient] = await ethers.getSigners();

  // build Liquidator
  const Liquidator = await ethers.getContractFactory('Liquidator') as Liquidator__factory;
  const liquidator = await Liquidator.deploy(
    recipient.address,
    ethers.utils.getAddress(SWAP_ROUTER),
    ethers.utils.getAddress(comet.address),
    ethers.utils.getAddress(UNISWAP_V3_FACTORY),
    ethers.utils.getAddress(WETH9),
    10e6, // min viable liquidation is for 10 USDC (base token) of collateral,
    [
      ethers.utils.getAddress(DAI),
      ethers.utils.getAddress(WETH9),
      ethers.utils.getAddress(WBTC),
      ethers.utils.getAddress(UNI),
      ethers.utils.getAddress(COMP),
      ethers.utils.getAddress(LINK)
    ],
    [false, false, false, false, true, true],
    [500, 500, 3000, 3000, 3000, 3000]
  );
  await liquidator.deployed();

  const mockDai = new ethers.Contract(DAI, daiAbi, signer);
  const mockUSDC = new ethers.Contract(USDC, usdcAbi, signer);
  const mockWETH = new ethers.Contract(WETH9, wethAbi, signer);
  const mockWBTC = new ethers.Contract(WBTC, wbtcAbi, signer);
  const mockUNI = new ethers.Contract(UNI, uniAbi, signer);
  const mockCOMP = new ethers.Contract(COMP, compAbi, signer);
  const mockLINK = new ethers.Contract(LINK, linkAbi, signer);

  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [DAI_WHALE],
  });
  const daiWhaleSigner = await ethers.getSigner(DAI_WHALE);

  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [USDC_WHALE],
  });
  const usdcWhaleSigner = await ethers.getSigner(USDC_WHALE);

  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [WETH_WHALE],
  });
  const wethWhaleSigner = await ethers.getSigner(WETH_WHALE);

  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [WBTC_WHALE],
  });
  const wbtcWhaleSigner = await ethers.getSigner(WBTC_WHALE);

  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [UNI_WHALE],
  });
  const uniWhaleSigner = await ethers.getSigner(UNI_WHALE);

  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [COMP_WHALE],
  });
  const compWhaleSigner = await ethers.getSigner(COMP_WHALE);

  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [LINK_WHALE],
  });
  const linkWhaleSigner = await ethers.getSigner(LINK_WHALE);

  await mockUSDC.connect(usdcWhaleSigner).transfer(signer.address, exp(300, 6));
  // transfer DAI to underwater user
  await mockDai.connect(daiWhaleSigner).transfer(underwaterUser.address, exp(200, 18));
  // transfer WETH to underwater user
  await mockWETH.connect(wethWhaleSigner).transfer(underwaterUser.address, exp(200, 18));
  // transfer WBTC to underwater user
  await mockWBTC.connect(wbtcWhaleSigner).transfer(underwaterUser.address, exp(2, 8));
  // transfer UNI to underwater user
  await mockUNI.connect(uniWhaleSigner).transfer(underwaterUser.address, exp(200, 18));
  // transfer COMP to underwater user
  await mockCOMP.connect(compWhaleSigner).transfer(underwaterUser.address, exp(200, 18));
  // transfer LINK to underwater user
  await mockLINK.connect(linkWhaleSigner).transfer(underwaterUser.address, exp(200, 18));

  return {
    comet: cometHarnessInterface,
    liquidator,
    users: [signer, underwaterUser, recipient],
    assets: {
      dai: mockDai,
      usdc: mockUSDC,
      weth: mockWETH,
      wbtc: mockWBTC,
      uni: mockUNI,
      comp: mockCOMP,
      link: mockLINK
    },
    whales: {
      daiWhale: daiWhaleSigner,
      usdcWhale: usdcWhaleSigner,
      wethWhale: wethWhaleSigner,
      wbtcWhale: wbtcWhaleSigner,
      uniWhale: uniWhaleSigner,
      compWhale: compWhaleSigner,
      linkWhale: linkWhaleSigner,
    }
  };
}

export async function forkMainnet() {
  const mainnetConfig = hre.config.networks.mainnet as HttpNetworkConfig;
  // fork from mainnet to make use of real Uniswap pools
  await ethers.provider.send(
    'hardhat_reset',
    [
      {
        forking: {
          jsonRpcUrl: mainnetConfig.url,
          blockNumber: 15125532
        },
      },
    ],
  );
}

export async function resetHardhatNetwork() {
  // reset to blank hardhat network
  await ethers.provider.send('hardhat_reset', []);
}