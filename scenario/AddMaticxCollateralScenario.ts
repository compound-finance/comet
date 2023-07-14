import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { utils } from 'ethers';
import { exp } from '../test/helpers';
import { COMP_WHALES, calldata } from '../src/deploy';
import { impersonateAddress } from '../plugins/scenario/utils';
import { fastL2GovernanceExecute, matchesDeployment } from './utils';
import { BaseBridgeReceiver } from '../build/types';
import { World } from '../plugins/scenario';

const MATICX_WHALES = {
  polygon: ['0x68B9220B8E617b7700aCAE1a5Ff43F3eb29257F3'],
};

scenario.only(
  'add new asset maticx',
  {
    filter: async (ctx) =>
      matchesDeployment(ctx, [{ network: 'polygon' }, { network: 'mumbai' }]),
    tokenBalances: {
      $comet: { $base: '>= 1' },
    },
  },
  async (
    { comet, configurator, proxyAdmin, actors, bridgeReceiver },
    context
  ) => {
    console.log('DEBUG::0');
    const { albert } = actors;
    console.log('DEBUG::1');
    const dm = context.world.deploymentManager;
    console.log('DEBUG::2');
    const maticx = await dm.existing(
      'MATICX',
      '0xfa68FB4628DFF1028CFEc22b4162FCcd0d45efb6',
      context.world.base.network,
      'contracts/ERC20.sol:ERC20'
    );
    console.log('DEBUG::3');
    const maticxPricefeed = await dm.existing(
      'MATICX:priceFeed',
      '0x5d37E4b374E6907de8Fc7fb33EE3b0af403C7403',
      context.world.base.network
    );
    console.log('DEBUG::4');

    // Allocate some tokens to Albert
    const maticxWhaleSigner = await impersonateAddress(
      dm,
      MATICX_WHALES.polygon[0]
    );
    console.log('DEBUG::5');
    console.log(
      'whale balance:',
      await maticx.balanceOf(maticxWhaleSigner.address)
    );
    // console.log(await maticx.proxyOwner());
    await maticx
      .connect(maticxWhaleSigner)
      .transfer(albert.address, exp(9000, 18).toString());
    console.log('DEBUG::6');

    // Execute a governance proposal to:
    // 1. Add new asset via Configurator
    // 2. Deploy and upgrade to new implementation of Comet
    const newAssetConfig = {
      asset: maticx.address,
      priceFeed: maticxPricefeed.address,
      decimals: await maticx.decimals(),
      borrowCollateralFactor: exp(0.55, 18),
      liquidateCollateralFactor: exp(0.65, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(6_000_000, 18),
    };
    console.log('DEBUG::7');

    const addAssetCalldata = await calldata(
      configurator.populateTransaction.addAsset(comet.address, newAssetConfig)
    );
    console.log('DEBUG::8');

    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );
    console.log('DEBUG::9');

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

    await fastL1ToPolygonGovernanceExecute(
      l2ProposalData,
      bridgeReceiver,
      context.world
    );
    console.log('DEBUG::10');

    // Try to supply new token and borrow base
    const baseAssetAddress = await comet.baseToken();
    console.log('DEBUG::11', baseAssetAddress);

    const borrowAmount = 1000n * (await comet.baseScale()).toBigInt();
    console.log('DEBUG::12', borrowAmount.toString());

    const supplyAmount = exp(9000, 18);
    console.log('DEBUG::13');

    await maticx
      .connect(albert.signer)
      .approve(comet.address, supplyAmount);
    console.log('DEBUG::14');

    await albert.supplyAsset({ asset: maticx.address, amount: supplyAmount });
    console.log(
      'DEBUG::15',
      await albert.getCometCollateralBalance(maticx.address)
    );

    await albert.withdrawAsset({
      asset: baseAssetAddress,
      amount: borrowAmount,
    });
    console.log('DEBUG::16');

    const cometMaticxAssetInfo = await comet.getAssetInfoByAddress(
      '0xfa68FB4628DFF1028CFEc22b4162FCcd0d45efb6'
    );
    console.log('maticx index:', cometMaticxAssetInfo.offset);

    expect(await albert.getCometCollateralBalance(maticx.address)).to.be.equal(
      supplyAmount
    );
    expect(await albert.getCometBaseBalance()).to.be.equal(-borrowAmount);
  }
);

async function fastL1ToPolygonGovernanceExecute(
  l2ProposalData: string,
  bridgeReceiver: BaseBridgeReceiver,
  world: World
) {
  const governanceDeploymentManager = world.auxiliaryDeploymentManager;
  if (!governanceDeploymentManager) {
    throw new Error(
      'cannot execute governance without governance deployment manager'
    );
  }

  const compWhale =
    world.base.network === 'polygon'
      ? COMP_WHALES.mainnet[0]
      : COMP_WHALES.testnet[0];
  const proposer = await impersonateAddress(
    governanceDeploymentManager,
    compWhale,
    exp(1, 18)
  ); // give them enough ETH to make the proposal

  const sendMessageToChildCalldata = utils.defaultAbiCoder.encode(
    ['address', 'bytes'],
    [bridgeReceiver.address, l2ProposalData]
  );

  const fxRoot = await governanceDeploymentManager.getContractOrThrow('fxRoot');

  await fastL2GovernanceExecute(
    governanceDeploymentManager,
    world.deploymentManager,
    proposer,
    [fxRoot.address],
    [0],
    ['sendMessageToChild(address,bytes)'],
    [sendMessageToChildCalldata]
  );
}
