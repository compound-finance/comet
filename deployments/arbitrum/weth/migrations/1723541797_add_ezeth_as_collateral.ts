import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';
import { ethers } from 'ethers';

const EZETH_ADDRESS = '0x2416092f143378750bb29b79eD961ab195CcEea5';
const EZETH_PRICE_FEED_ADDRESS = '0x989a480b6054389075CBCdC385C18CfB6FC08186';

let newPriceFeed: string;

export default migration('1723541797_add_ezeth_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _ezETHScalingPriceFeed = await deploymentManager.deploy(
      'ezETH:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        EZETH_PRICE_FEED_ADDRESS, // ezETH / ETH price feed
        8                         // decimals
      ]
    );

    return { ezETHScalingPriceFeed: _ezETHScalingPriceFeed.address };
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, { ezETHScalingPriceFeed }) => {
    const trace = deploymentManager.tracer();
    const {
      bridgeReceiver,
      timelock: l2Timelock,
      comet,
      cometAdmin,
      configurator
    } = await deploymentManager.getContracts();

    const {
      arbitrumInbox,
      timelock,
      governor
    } = await govDeploymentManager.getContracts();

    newPriceFeed = ezETHScalingPriceFeed;

    const ezETH = await deploymentManager.existing(
      'ezETH',
      EZETH_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    const ezETHPriceFeed = await deploymentManager.existing(
      'ezETH:priceFeed',
      ezETHScalingPriceFeed,
      'arbitrum'
    );

    const ezETHAssetConfig = {
      asset: ezETH.address,
      priceFeed: ezETHPriceFeed.address,
      decimals: 18n,
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.91, 18),
      liquidationFactor: exp(0.94, 18),
      supplyCap: exp(2500, 18),
    };

    const addAssetCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'tuple(address,address,uint8,uint64,uint64,uint64,uint128)'],
      [comet.address,
        [
          ezETHAssetConfig.asset,
          ezETHAssetConfig.priceFeed,
          ezETHAssetConfig.decimals,
          ezETHAssetConfig.borrowCollateralFactor,
          ezETHAssetConfig.liquidateCollateralFactor,
          ezETHAssetConfig.liquidationFactor,
          ezETHAssetConfig.supplyCap
        ]
      ]
    );

    const deployAndUpgradeToCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );

    const l2ProposalData = ethers.utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          cometAdmin.address
        ],
        [
          0,
          0
        ],
        [
          'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          addAssetCalldata,
          deployAndUpgradeToCalldata,
        ]
      ]
    );

    const createRetryableTicketGasParams = await estimateL2Transaction(
      {
        from: applyL1ToL2Alias(timelock.address),
        to: bridgeReceiver.address,
        data: l2ProposalData
      },
      deploymentManager
    );
    const refundAddress = l2Timelock.address;

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo WETH Comet on Arbitrum.
      {
        contract: arbitrumInbox,
        signature: 'createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
        args: [
          bridgeReceiver.address,                           // address to,
          0,                                                // uint256 l2CallValue,
          createRetryableTicketGasParams.maxSubmissionCost, // uint256 maxSubmissionCost,
          refundAddress,                                    // address excessFeeRefundAddress,
          refundAddress,                                    // address callValueRefundAddress,
          createRetryableTicketGasParams.gasLimit,          // uint256 gasLimit,
          createRetryableTicketGasParams.maxFeePerGas,      // uint256 maxFeePerGas,
          l2ProposalData,                                   // bytes calldata data
        ],
        value: createRetryableTicketGasParams.deposit
      },
    ];

    const description = '# Add ezETH as collateral into cWETHv3 on Arbitrum\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add ezETH into cWETHv3 on Arbitrum network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Arbitrum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/gauntlet-wsteth-and-ezeth-asset-listing/5404/11).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/907) and [forum discussion](https://www.comp.xyz/t/gauntlet-wsteth-and-ezeth-asset-listing/5404).\n\n\n## Proposal Actions\n\nThe first proposal action adds ezETH to the WETH Comet on Arbitrum. This sends the encoded `addAsset` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Arbitrum.';
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(mainnetActions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');

    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  }, 

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const ezETHAssetIndex = Number(await comet.numAssets()) - 1;

    const ezETH = await deploymentManager.existing(
      'ezETH',
      EZETH_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    const ezETHAssetConfig = {
      asset: ezETH.address,
      priceFeed: newPriceFeed,
      decimals: 18n,
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.91, 18),
      liquidationFactor: exp(0.94, 18),
      supplyCap: exp(2500, 18),
    };

    // 1. & 2. Compare ezETH asset config with Comet and Configurator asset info
    const cometEzETHAssetInfo = await comet.getAssetInfoByAddress(EZETH_ADDRESS);
    expect(ezETHAssetIndex).to.be.equal(cometEzETHAssetInfo.offset);
    expect(ezETHAssetConfig.asset).to.be.equal(cometEzETHAssetInfo.asset);
    expect(exp(1, ezETHAssetConfig.decimals)).to.be.equal(cometEzETHAssetInfo.scale);
    expect(ezETHAssetConfig.borrowCollateralFactor).to.be.equal(cometEzETHAssetInfo.borrowCollateralFactor);
    expect(ezETHAssetConfig.liquidateCollateralFactor).to.be.equal(cometEzETHAssetInfo.liquidateCollateralFactor);
    expect(ezETHAssetConfig.liquidationFactor).to.be.equal(cometEzETHAssetInfo.liquidationFactor);
    expect(ezETHAssetConfig.supplyCap).to.be.equal(cometEzETHAssetInfo.supplyCap);

    const configuratorEzETHAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[ezETHAssetIndex];
    expect(ezETHAssetConfig.asset).to.be.equal(configuratorEzETHAssetConfig.asset);
    expect(ezETHAssetConfig.decimals).to.be.equal(configuratorEzETHAssetConfig.decimals);
    expect(ezETHAssetConfig.borrowCollateralFactor).to.be.equal(configuratorEzETHAssetConfig.borrowCollateralFactor);
    expect(ezETHAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorEzETHAssetConfig.liquidateCollateralFactor);
    expect(ezETHAssetConfig.liquidationFactor).to.be.equal(configuratorEzETHAssetConfig.liquidationFactor);
    expect(ezETHAssetConfig.supplyCap).to.be.equal(configuratorEzETHAssetConfig.supplyCap);
  },
});
