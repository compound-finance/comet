import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { utils } from 'ethers';
import { exp } from '../test/helpers';
import { calldata } from '../src/deploy';
import { impersonateAddress } from '../plugins/scenario/utils';
import { createCrossChainProposal, matchesDeployment } from './utils';

const MATICX_ADDRESS = '0xfa68FB4628DFF1028CFEc22b4162FCcd0d45efb6';
const MATICX_PRICE_FEED_ADDRESS = '0x5d37E4b374E6907de8Fc7fb33EE3b0af403C7403';
const MATICX_WHALES = {
  polygon: ['0x68B9220B8E617b7700aCAE1a5Ff43F3eb29257F3'],
};

// TODO: add ability to run ad hoc scenarios against a single migration, to avoid needing the scenario to do all this setup of
// listing an asset
scenario(
  'add new asset maticx',
  {
    filter: async (ctx) =>
      matchesDeployment(ctx, [{ network: 'polygon' }]),
    tokenBalances: {
      $comet: { $base: '>= 1' },
    },
  },
  async (
    { comet, configurator, proxyAdmin, actors, bridgeReceiver },
    context
  ) => {
    const { albert } = actors;
    const dm = context.world.deploymentManager;
    const maticx = await dm.existing(
      'MATICX',
      MATICX_ADDRESS,
      context.world.base.network,
      'contracts/ERC20.sol:ERC20'
    );
    const maticxPricefeed = await dm.existing(
      'MATICX:priceFeed',
      MATICX_PRICE_FEED_ADDRESS,
      context.world.base.network
    );

    // Allocate some tokens to Albert
    const maticxWhaleSigner = await impersonateAddress(
      dm,
      MATICX_WHALES.polygon[0]
    );
    await maticx
      .connect(maticxWhaleSigner)
      .transfer(albert.address, exp(9000, 18).toString());

    // Execute a governance proposal to:
    // 1. Add new asset via Configurator
    // 2. Deploy and upgrade to new implementation of Comet
    const newAssetConfig = {
      asset: maticx.address,
      priceFeed: maticxPricefeed.address,
      decimals: await maticx.decimals(),
      borrowCollateralFactor: exp(0.55, 18),
      liquidateCollateralFactor: exp(0.60, 18),
      liquidationFactor: exp(0.93, 18),
      supplyCap: exp(6_000_000, 18),
    };

    const addAssetCalldata = await calldata(
      configurator.populateTransaction.addAsset(comet.address, newAssetConfig)
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );
    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [configurator.address, proxyAdmin.address],
        [0, 0],
        [
          'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'deployAndUpgradeTo(address,address)',
        ],
        [addAssetCalldata, deployAndUpgradeToCalldata],
      ]
    );

    await createCrossChainProposal(context, l2ProposalData, bridgeReceiver);


    // Try to supply new token and borrow base
    const baseAssetAddress = await comet.baseToken();
    const borrowAmount = 1000n * (await comet.baseScale()).toBigInt();
    const supplyAmount = exp(9000, 18);

    await maticx
      .connect(albert.signer)
      .approve(comet.address, supplyAmount);
    await albert.supplyAsset({ asset: maticx.address, amount: supplyAmount });
    await albert.withdrawAsset({
      asset: baseAssetAddress,
      amount: borrowAmount,
    });

    expect(await albert.getCometCollateralBalance(maticx.address)).to.be.equal(
      supplyAmount
    );
    expect(await albert.getCometBaseBalance()).to.be.equal(-borrowAmount);
  }
);
