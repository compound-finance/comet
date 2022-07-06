import { ethers } from 'hardhat';
import {
  CometExt__factory,
  CometHarness__factory,
  CometHarnessInterface,
  Liquidator,
  Liquidator__factory
} from '../../build/types';
import {
  COMP,
  COMP_USDC_PRICE_FEED,
  DAI,
  DAI_USDC_PRICE_FEED,
  LINK,
  LINK_USDC_PRICE_FEED,
  SWAP_ROUTER,
  UNI,
  UNI_USDC_PRICE_FEED,
  USDC,
  USDC_USD_PRICE_FEED,
  WBTC,
  WBTC_USDC_PRICE_FEED,
  WETH9,
  ETH_USDC_PRICE_FEED,
  UNISWAP_V3_FACTORY
} from "./addresses";

export default async function makeLiquidatableProtocol() {
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
  const cometHarnessInterface = await ethers.getContractAt('CometHarnessInterface', comet.address) as CometHarnessInterface;

  const Liquidator = await ethers.getContractFactory('Liquidator') as Liquidator__factory;
  const liquidator = await Liquidator.deploy(
    ethers.utils.getAddress(SWAP_ROUTER),
    ethers.utils.getAddress(comet.address),
    ethers.utils.getAddress(UNISWAP_V3_FACTORY),
    ethers.utils.getAddress(WETH9),
    [ethers.utils.getAddress(DAI), ethers.utils.getAddress(COMP)],
    [100, 500]
  );
  await liquidator.deployed();



  return {
    comet: cometHarnessInterface,
    liquidator
  }
}
