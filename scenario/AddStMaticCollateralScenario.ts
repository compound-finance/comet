import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { utils } from 'ethers';
import { exp } from '../test/helpers';
import { calldata } from '../src/deploy';
import { impersonateAddress } from '../plugins/scenario/utils';
import { createCrossChainProposal, matchesDeployment } from './utils';

const STMATIC_ADDRESS = '0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C4';
const STMATIC_PRICE_FEED_ADDRESS = '0x97371dF4492605486e23Da797fA68e55Fc38a13f';
const STMATIC_WHALES = {
  polygon: ['0x24d987191fcf14b371d04d1f3df86281aaad2d2e'],
};

// TODO: add ability to run ad hoc scenarios against a single migration, to avoid needing the scenario to do all this setup of
// listing an asset
scenario(
  'add new asset stmatic',
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
    const stmatic = await dm.existing(
      'STMATIC',
      STMATIC_ADDRESS,
      context.world.base.network,
      'contracts/ERC20.sol:ERC20'
    );
    const stmaticPricefeed = await dm.existing(
      'STMATIC:priceFeed',
      STMATIC_PRICE_FEED_ADDRESS,
      context.world.base.network
    );

    // Allocate some tokens to Albert
    const stmaticWhaleSigner = await impersonateAddress(
      dm,
      STMATIC_WHALES.polygon[0]
    );
    await stmatic
      .connect(stmaticWhaleSigner)
      .transfer(albert.address, exp(9000, 18).toString());

    // Execute a governance proposal to:
    // 1. Add new asset via Configurator
    // 2. Deploy and upgrade to new implementation of Comet
    const newAssetConfig = {
      asset: stmatic.address,
      priceFeed: stmaticPricefeed.address,
      decimals: await stmatic.decimals(),
      borrowCollateralFactor: exp(0.60, 18),
      liquidateCollateralFactor: exp(0.65, 18),
      liquidationFactor: exp(0.07, 18),
      supplyCap: exp(8_000_000, 18)
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

    await stmatic
      .connect(albert.signer)
      .approve(comet.address, supplyAmount);
    await albert.supplyAsset({ asset: stmatic.address, amount: supplyAmount });
    await albert.withdrawAsset({
      asset: baseAssetAddress,
      amount: borrowAmount,
    });

    expect(await albert.getCometCollateralBalance(stmatic.address)).to.be.equal(
      supplyAmount
    );
    expect(await albert.getCometBaseBalance()).to.be.equal(-borrowAmount);
  }
);