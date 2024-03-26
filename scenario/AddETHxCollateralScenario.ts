import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { utils } from 'ethers';
import { exp } from '../test/helpers';
import { calldata } from '../src/deploy';
import { impersonateAddress } from '../plugins/scenario/utils';
import { isBridgedDeployment } from './utils';

const ETHX_ADDRESS = '0xA35b1B31Ce002FBF2058D22F30f95D405200A15b';
const ETHX_PRICE_FEED_ADDRESS = '0xdd487947c579af433AeeF038Bf1573FdBB68d2d3';
const ETHX_WHALES = {
  mainnet: ['0xc5c75caf067ae899a7ec10b86b5ab38c13879388']
};


scenario(
  'add new asset ETHx',
  {
    filter: async (ctx) => !isBridgedDeployment(ctx),
    tokenBalances: {
      $comet: { $base: '>= 1' },
    },
  },
  async ({ comet, configurator, proxyAdmin, actors }, context) => {
    const { albert } = actors;
    const dm = context.world.deploymentManager;
    const ethx = await dm.existing(
      'ETHX',
      ETHX_ADDRESS,
      context.world.base.network,
      'contracts/ERC20.sol:ERC20'
    );
    const ethxPricefeed = await dm.existing(
      'ETHX:priceFeed',
      ETHX_PRICE_FEED_ADDRESS,
      context.world.base.network
    );

    // Allocate some tokens to Albert
    const ethxWhaleSigner = await impersonateAddress(
      dm,
      ETHX_WHALES.mainnet[0]
    );
    await ethx
      .connect(ethxWhaleSigner)
      .transfer(albert.address, exp(500, 18).toString());

    // Execute a governance proposal to:
    // 1. Add new asset via Configurator
    // 2. Deploy and upgrade to new implementation of Comet
    const newAssetConfig = {
      asset: ethx.address,
      priceFeed: ethxPricefeed.address,
      decimals: await ethx.decimals(),
      borrowCollateralFactor: exp(0.9, 18),
      liquidateCollateralFactor: exp(0.93, 18),
      liquidationFactor: exp(0.975, 18),
      supplyCap: exp(5_000, 18),
    };

    const addAssetCalldata = await calldata(
      configurator.populateTransaction.addAsset(comet.address, newAssetConfig)
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );
    await context.fastGovernanceExecute(
      [configurator.address, proxyAdmin.address],
      [0, 0],
      [
        'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        'deployAndUpgradeTo(address,address)',
      ],
      [addAssetCalldata, deployAndUpgradeToCalldata]
    );

    // Try to supply new token and borrow base
    const baseAssetAddress = await comet.baseToken();
    const borrowAmount = 60n * (await comet.baseScale()).toBigInt();
    const supplyAmount = exp(100, 18);

    await ethx.connect(albert.signer).approve(comet.address, supplyAmount);
    await albert.supplyAsset({ asset: ethx.address, amount: supplyAmount });
    await albert.withdrawAsset({
      asset: baseAssetAddress,
      amount: borrowAmount,
    });

    expect(await albert.getCometCollateralBalance(ethx.address)).to.be.equal(
      supplyAmount
    );
    expect(await albert.getCometBaseBalance()).to.be.equal(-borrowAmount);
  }
);