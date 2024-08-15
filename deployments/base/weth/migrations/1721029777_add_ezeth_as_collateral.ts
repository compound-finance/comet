import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';

const EZETH_ADDRESS = '0x2416092f143378750bb29b79eD961ab195CcEea5';
const EZETH_ETH_PRICE_FEED_ADDRESS = '0xC4300B7CF0646F0Fe4C5B2ACFCCC4dCA1346f5d8';
let newPriceFeedAddress: string;

export default migration('1721029777_add_ezeth_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _ezETHScalingPriceFeed = await deploymentManager.deploy(
      'ezETH:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        EZETH_ETH_PRICE_FEED_ADDRESS,    // ezETH / ETH price feed
        8,                               // decimals
      ]
    );
    return { ezETHScalingPriceFeed: _ezETHScalingPriceFeed.address };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    { ezETHScalingPriceFeed }
  ) => {
    const trace = deploymentManager.tracer();

    const ezETH = await deploymentManager.existing(
      'ezETH',
      EZETH_ADDRESS,
      'base',
      'contracts/ERC20.sol:ERC20'
    );
    const ezETHPricefeed = await deploymentManager.existing(
      'ezETH:priceFeed',
      ezETHScalingPriceFeed,
      'base'
    );

    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const { governor, baseL1CrossDomainMessenger } = await govDeploymentManager.getContracts();

    const newAssetConfig = {
      asset: ezETH.address,
      priceFeed: ezETHPricefeed.address,
      decimals: await ezETH.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(500, 18),
    };

    newPriceFeedAddress = ezETHPricefeed.address;

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
        [configurator.address, cometAdmin.address],
        [0, 0],
        [
          'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'deployAndUpgradeTo(address,address)',
        ],
        [addAssetCalldata, deployAndUpgradeToCalldata],
      ]
    );

    const mainnetActions = [
      // Send the proposal to the L2 bridge
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000]
      },
    ];

    const description = '# Add ezETH as collateral into cWETHv3 on Base\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add ezETH into cWETHv3 on Base network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Base. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/gauntlet-wsteth-and-ezeth-asset-listing/5404/1).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/888) and [forum discussion](https://www.comp.xyz/t/gauntlet-wsteth-and-ezeth-asset-listing/5404).\n\n\n## Proposal Actions\n\nThe first proposal action adds ezETH to the WETH Comet on Base. This sends the encoded `addAsset` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Base.';
    const txn = await govDeploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      )
    );

    const event = txn.events.find(
      (event) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const ezETHAssetIndex = Number(await comet.numAssets()) - 1;

    const ezETHAssetConfig = {
      asset: EZETH_ADDRESS,
      priceFeed: newPriceFeedAddress,
      decimals: 18,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(500, 18),
    };

    // 1. Compare proposed asset config with Comet asset info
    const ezETHAssetInfo = await comet.getAssetInfoByAddress(
      EZETH_ADDRESS
    );
    expect(ezETHAssetIndex).to.be.equal(ezETHAssetInfo.offset);
    expect(ezETHAssetConfig.asset).to.be.equal(ezETHAssetInfo.asset);
    expect(ezETHAssetConfig.priceFeed).to.be.equal(
      ezETHAssetInfo.priceFeed
    );
    expect(exp(1, ezETHAssetConfig.decimals)).to.be.equal(
      ezETHAssetInfo.scale
    );
    expect(ezETHAssetConfig.borrowCollateralFactor).to.be.equal(
      ezETHAssetInfo.borrowCollateralFactor
    );
    expect(ezETHAssetConfig.liquidateCollateralFactor).to.be.equal(
      ezETHAssetInfo.liquidateCollateralFactor
    );
    expect(ezETHAssetConfig.liquidationFactor).to.be.equal(
      ezETHAssetInfo.liquidationFactor
    );
    expect(ezETHAssetConfig.supplyCap).to.be.equal(
      ezETHAssetInfo.supplyCap
    );

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorEzETHAssetConfig = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[ezETHAssetIndex];
    expect(ezETHAssetConfig.asset).to.be.equal(
      configuratorEzETHAssetConfig.asset
    );
    expect(ezETHAssetConfig.priceFeed).to.be.equal(
      configuratorEzETHAssetConfig.priceFeed
    );
    expect(ezETHAssetConfig.decimals).to.be.equal(
      configuratorEzETHAssetConfig.decimals
    );
    expect(ezETHAssetConfig.borrowCollateralFactor).to.be.equal(
      configuratorEzETHAssetConfig.borrowCollateralFactor
    );
    expect(ezETHAssetConfig.liquidateCollateralFactor).to.be.equal(
      configuratorEzETHAssetConfig.liquidateCollateralFactor
    );
    expect(ezETHAssetConfig.liquidationFactor).to.be.equal(
      configuratorEzETHAssetConfig.liquidationFactor
    );
    expect(ezETHAssetConfig.supplyCap).to.be.equal(
      configuratorEzETHAssetConfig.supplyCap
    );
  },
});
