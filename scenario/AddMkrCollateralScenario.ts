import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { utils } from 'ethers';
import { exp } from '../test/helpers';
import { calldata } from '../src/deploy';
import { impersonateAddress } from '../plugins/scenario/utils';
import { erc20 } from '../plugins/scenario/utils/ERC20';
import { isBridgedDeployment } from './utils';

const MKR_WHALES = {
  mainnet: [
    '0xF977814e90dA44bFA03b6295A0616a897441aceC',
    '0x7d6149aD9A573A6E2Ca6eBf7D4897c1B766841B4',
    '0xf37216a8aC034D08B4663108d7532DFcb44583ed',
  ]
};

scenario.only('add new asset mkr',
  {
    filter: async (ctx) => !isBridgedDeployment(ctx),
    tokenBalances: {
      $comet: { $base: '>= 1000' },
    },
  },
  async ({ comet, configurator, proxyAdmin, actors }, context) => {
    const { albert } = actors;

    const dm = context.world.deploymentManager;
    const maker = await dm.existing('MKR', '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2');

    // Deploy new price feed for MKR
    const makerPricefeed = await dm.deploy(
      'MKR:priceFeed',
      'test/SimplePriceFeed.sol',
      [exp(1_000, 8).toString(), 8],
      true
    );

    // Allocate some tokens to Albert
    const mkrWhaleSigner = await impersonateAddress(dm, MKR_WHALES.mainnet[0]);
    await maker.connect(mkrWhaleSigner).transfer(albert.address, exp(500, 18).toString());

    // Execute a governance proposal to:
    // 1. Add new asset via Configurator
    // 2. Deploy and upgrade to new implementation of Comet
    const newAssetConfig = {
      asset: maker.address,
      priceFeed: makerPricefeed.address,
      decimals: await maker.decimals(),
      borrowCollateralFactor: exp(0.8, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(1000, 18),
    };

    const addAssetCalldata = await calldata(configurator.populateTransaction.addAsset(comet.address, newAssetConfig));
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [configurator.address, comet.address]);

    await context.fastGovernanceExecute(
      [configurator.address, proxyAdmin.address],
      [0, 0],
      ['addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))', 'deployAndUpgradeTo(address,address)'],
      [addAssetCalldata, deployAndUpgradeToCalldata]
    );

    // Try to supply new token and borrow base
    const baseAssetAddress = await comet.baseToken();
    const borrowAmount = 1_000n * (await comet.baseScale()).toBigInt();
    await maker.connect(albert.signer)['approve(address,uint256)'](comet.address, exp(50, 18));
    await albert.supplyAsset({ asset: maker.address, amount: exp(50, 18) });
    await albert.withdrawAsset({ asset: baseAssetAddress, amount: borrowAmount });

    expect(await albert.getCometCollateralBalance(maker.address)).to.be.equal(exp(50, 18));
    expect(await albert.getCometBaseBalance()).to.be.equal(-borrowAmount);
  });