import { event, expect, exp, factor, defaultAssets, makeProtocol, mulPrice, portfolio, wait, setTotalsBasic } from './helpers';

// describe.only('Liquidation bot', function () {
//   it('runs a test', async () => {
//     const { comet, users: [alice, bob] } = await makeProtocol();
//
//     expect(true).to.be.true;
//   });
// });


import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  CometHarness,
  CometHarness__factory,
  Liquidator,
  Liquidator__factory
} from '../build/types';


// import { DAI, USDC, WETH9, swapRouter, uniswapv3factory } from "../scripts/address";
// import { Liquidator, CometDummy } from "../typechain";

// mainnet
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


describe.only("Liquidator", function () {
  let comet: CometHarness;
  let liquidator: Liquidator;

  let owner: SignerWithAddress;
  let addr1: SignerWithAddress;
  let addrs: SignerWithAddress[];

  before(async () => {
    [owner, addr1, ...addrs] = await ethers.getSigners();
    // Deploy comet

    // const CometFactory = (await ethers.getContractFactory('CometHarness')) as CometHarness__factory;
    // const Comet = await ethers.getContractFactory("CometDummy");
    // comet = await CometFactory.deploy(ethers.utils.getAddress(USDC));
    // await comet.deployed();
    const { comet, users: [alice, bob] } = await makeProtocol();

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

  it("Should execute flash swap", async () => {
    const tx = await liquidator.initFlash({
      // XXX add accounts
      accounts: [],
      pairToken: ethers.utils.getAddress(DAI),
      poolFee: 500,
      reversedPair: false,
    });

    expect(tx.hash).to.be.not.null;
  });
});
