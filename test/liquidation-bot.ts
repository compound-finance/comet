import { event, expect, exp, factor, defaultAssets, makeProtocol, mulPrice, portfolio, wait, setTotalsBasic } from './helpers';

import hre, { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
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

// mainnet
// export const DAI_WHALE = "0x6b175474e89094c44da98b954eedeac495271d0f";
export const DAI_WHALE = "0x7a8edc710ddeadddb0b539de83f3a306a621e823";
export const USDC_WHALE = "0xA929022c9107643515F5c777cE9a910F0D1e490C";
export const WETH_WHALE = "0x0F4ee9631f4be0a63756515141281A3E2B293Bbe";
export const WBTC = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
export const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
export const USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7";
export const COMP = "0xc00e94cb662c3520282e6f5717214004a7f26888";
export const LINK = "0x514910771AF9Ca656af840dff83E8264EcF986CA";
export const DAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
export const UNI = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984";
export const WETH9 = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

export const swapRouter = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
export const uniswapv3factory = "0x1F98431c8aD98523631AE4a59f267346ea31F984";

const USDC_USD_PRICE_FEED = "0x8fffffd4afb6115b954bd326cbe7b4ba576818f6";

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
        priceFeed: "0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9",
        decimals: 18,
        borrowCollateralFactor: 999999999999999999n,
        liquidateCollateralFactor: 1000000000000000000n,
        liquidationFactor: 1000000000000000000n,
        supplyCap: 100000000000000000000n
      },
      // {
      //   asset: '0x162700d1613DfEC978032A909DE02643bC55df1A',
      //   priceFeed: '0xD5724171C2b7f0AA717a324626050BD05767e2C6',
      //   decimals: 18,
      //   borrowCollateralFactor: 999999999999999999n,
      //   liquidateCollateralFactor: 1000000000000000000n,
      //   liquidationFactor: 1000000000000000000n,
      //   supplyCap: 100000000000000000000n
      // },
      // {
      //   asset: '0x67aD6EA566BA6B0fC52e97Bc25CE46120fdAc04c',
      //   priceFeed: '0x70eE76691Bdd9696552AF8d4fd634b3cF79DD529',
      //   decimals: 8,
      //   borrowCollateralFactor: 999999999999999999n,
      //   liquidateCollateralFactor: 1000000000000000000n,
      //   liquidationFactor: 1000000000000000000n,
      //   supplyCap: 10000000000n
      // }
    ]
  };

  const comet = await CometFactory.deploy(config);
  await comet.deployed();
  console.log(`comet.address: ${comet.address}`);
  const cometHarnessInterface = await ethers.getContractAt('CometHarnessInterface', comet.address) as CometHarnessInterface;
  return cometHarnessInterface;
}

describe.only("Liquidator", function () {
  let comet: CometHarnessInterface;
  let liquidator: Liquidator;

  let owner: SignerWithAddress;
  let addr1: SignerWithAddress;
  let addrs: SignerWithAddress[];

  before(async () => {
    [owner, addr1, ...addrs] = await ethers.getSigners();
    // Deploy comet
    // const { comet, users: [alice, bob] } = await makeProtocol();
    comet = await makeProtocolAlt();

    // Deploy liquidator
    const Liquidator = await ethers.getContractFactory("Liquidator") as Liquidator__factory;
    liquidator = await Liquidator.deploy(
      ethers.utils.getAddress(swapRouter),
      ethers.utils.getAddress(comet.address),
      ethers.utils.getAddress(uniswapv3factory),
      ethers.utils.getAddress(WETH9)
    );
    await liquidator.deployed();
  });

  it("Should init liquidator", async function () {
    expect(await liquidator.swapRouter()).to.equal(swapRouter);
  });

  it.only("Should execute flash swap", async () => {
  // Set underwater account
    await setTotalsBasic(comet, {
      baseBorrowIndex: 2e15,
      baseSupplyIndex: 2e15,
      totalSupplyBase: 20000000000000n,
      totalBorrowBase: 20000000000000n
    });

    await comet.setCollateralBalance(addr1.address, DAI, exp(100, 18));
    await comet.setBasePrincipal(addr1.address, -(exp(200, 6)));

    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [DAI_WHALE],
    });
    let daiWhaleSigner = await ethers.getSigner(DAI_WHALE);

    const mockDai = new ethers.Contract(DAI, daiAbi, owner);

    console.log(`await mockDai.balanceOf(DAI_WHALE): ${await mockDai.balanceOf(DAI_WHALE)}`);
    console.log(`await mockDai.balanceOf(comet.address): ${await mockDai.balanceOf(comet.address)}`);
    // await mockDai.mint(comet.address, 1234567);
    await mockDai.connect(daiWhaleSigner).transfer(comet.address, 100000000000000000000n);

    console.log(`await mockDai.balanceOf(DAI_WHALE): ${await mockDai.balanceOf(DAI_WHALE)}`);
    console.log(`await mockDai.balanceOf(comet.address): ${await mockDai.balanceOf(comet.address)}`);

    // const filter = mockDai.filters.Transfer(ethers.constants.AddressZero);
    // console.log(
    //   await mockDai.queryFilter(filter, 14900000)
    // );

    const tx = await liquidator.initFlash({
      // XXX add accounts
      accounts: [addr1.address],
      pairToken: ethers.utils.getAddress(DAI),
      poolFee: 500,
      reversedPair: false,
    });

    // expect(tx.hash).to.be.not.null;
  });
});
