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
  DAI,
  DAI_USDC_PRICE_FEED,
  DAI_WHALE,
  LINK,
  LINK_USDC_PRICE_FEED,
  SWAP_ROUTER,
  UNI,
  UNI_USDC_PRICE_FEED,
  USDC,
  USDC_USD_PRICE_FEED,
  USDC_WHALE,
  WBTC,
  WBTC_USDC_PRICE_FEED,
  WETH9,
  ETH_USDC_PRICE_FEED,
  UNISWAP_V3_FACTORY
} from './addresses';
import daiAbi from './dai-abi';
import usdcAbi from './usdc-abi';

export default async function makeLiquidatableProtocol() {
  // build Comet
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

  // configure Comet
  await setTotalsBasic(cometHarnessInterface, {
    baseBorrowIndex: 2e15,
    baseSupplyIndex: 2e15,
    totalSupplyBase: 20000000000000n,
    totalBorrowBase: 20000000000000n
  });

  // build Liquidator
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

  // create underwater user
  const [signer, underwaterUser] = await ethers.getSigners();

  const mockDai = new ethers.Contract(DAI, daiAbi, signer);
  const mockUSDC = new ethers.Contract(USDC, usdcAbi, signer);

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

  // transfer DAI to Comet, so the protocol can sell them
  await mockDai.connect(daiWhaleSigner).transfer(comet.address, 200000000000000000000n);
  // transfer USDC to comet, so it has money to pay out withdraw to underwater user
  await mockUSDC.connect(usdcWhaleSigner).transfer(comet.address, 300000000n); // 300e6
  // transfer USDC to signer, so it has money to purchase collateral (is this still necessary?)
  await mockUSDC.connect(usdcWhaleSigner).transfer(signer.address, 300000000n); // 300e6
  // transfer DAI to underwater user (is this still necessary?)
  await mockDai.connect(daiWhaleSigner).transfer(underwaterUser.address, 200000000000000000000n);
  // underwater user approves Comet
  await mockDai.connect(underwaterUser).approve(comet.address, 120000000000000000000n);
  // underwater user supplies DAI to Comet
  await comet.connect(underwaterUser).supply(DAI, 120000000000000000000n); //
  // user borrows (required to ensure there is a Withdraw event for the user)
  await comet.connect(underwaterUser).withdraw(USDC, 10e6);
  // artificially put in an underwater borrow position
  await comet.setBasePrincipal(underwaterUser.address, -(exp(200, 6)));

  return {
    comet: cometHarnessInterface,
    liquidator,
    users: [signer, underwaterUser]
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
        },
      },
    ],
  );
}

export async function resetHardhatNetwork() {
  // reset to blank hardhat network
  await ethers.provider.send('hardhat_reset', []);
}