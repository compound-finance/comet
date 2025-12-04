import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';
import { ethers } from 'ethers';

const TETH_ADDRESS = '0xd09ACb80C1E8f2291862c4978A008791c9167003';

const TETH_TO_WSTETH_PRICE_FEED_ADDRESS = '0x98a977Ba31C72aeF2e15B950Eb5Ae3158863D856';
const WSTETH_TO_USD_PRICE_FEED_ADDRESS = '0x92014e7f331dFaB2848A5872AA8b2E7b6f3cE8B4';

let newPriceFeed: string;

export default migration('1762444270_add_teth_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _tETHPriceFeed = await deploymentManager.deploy(
      'tETH:priceFeed',
      'pricefeeds/MultiplicativePriceFeed.sol',
      [
        TETH_TO_WSTETH_PRICE_FEED_ADDRESS,  // tETH / ETH price feed
        WSTETH_TO_USD_PRICE_FEED_ADDRESS,    // ETH / USD price feed
        8,                                // decimals
        'tETH / USD price feed'          // description
      ]
    );

    return {
      tETHPriceFeedAddress: _tETHPriceFeed.address,
    };
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, {
    tETHPriceFeedAddress
  }) => {
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

    newPriceFeed = tETHPriceFeedAddress;

    const tETH = await deploymentManager.existing(
      'tETH',
      TETH_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    const tETHPriceFeed = await deploymentManager.existing(
      'tETH:priceFeed',
      tETHPriceFeedAddress,
      'arbitrum'
    );

    const tETHAssetConfig = {
      asset: tETH.address,
      priceFeed: tETHPriceFeed.address,
      decimals: 18n,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(50, 18),
    };

    const addAssetCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'tuple(address,address,uint8,uint64,uint64,uint64,uint128)'],
      [
        comet.address,
        [
          tETHAssetConfig.asset,
          tETHAssetConfig.priceFeed,
          tETHAssetConfig.decimals,
          tETHAssetConfig.borrowCollateralFactor,
          tETHAssetConfig.liquidateCollateralFactor,
          tETHAssetConfig.liquidationFactor,
          tETHAssetConfig.supplyCap
        ]
      ]
    );

    const deployAndUpgradeToCalldataUSDC = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );

    const l2ProposalData = ethers.utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          cometAdmin.address,
        ],
        [
          0,
          0,
        ],
        [
          'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          addAssetCalldata,
          deployAndUpgradeToCalldataUSDC,
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
      // 1. Set Comet configuration and deployAndUpgradeTo USDC Comet on Arbitrum.
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

    const description = `DESCRIPTION`;

    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(mainnetActions, description)))), 0, 300_000
    );

    const event = txn.events.find((event: { event: string }) => event.event === 'ProposalCreated');

    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    const { comet } = await deploymentManager.getContracts();

    try {
      await comet.getAssetInfoByAddress(TETH_ADDRESS);
      return true;
    } catch (error) {
      return false;
    }
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const tETH = await deploymentManager.existing(
      'tETH',
      TETH_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    const tETHAssetConfig = {
      asset: tETH.address,
      priceFeed: newPriceFeed,
      decimals: 18n,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(50, 18),
    };

    const tETHAssetIndex = Number(await comet.numAssets()) - 1;
    const cometTETHAssetInfo = await comet.getAssetInfoByAddress(TETH_ADDRESS);
    expect(tETHAssetIndex).to.be.equal(cometTETHAssetInfo.offset);
    expect(tETHAssetConfig.asset).to.be.equal(cometTETHAssetInfo.asset);
    expect(exp(1, tETHAssetConfig.decimals)).to.be.equal(cometTETHAssetInfo.scale);
    expect(tETHAssetConfig.borrowCollateralFactor).to.be.equal(cometTETHAssetInfo.borrowCollateralFactor);
    expect(tETHAssetConfig.liquidateCollateralFactor).to.be.equal(cometTETHAssetInfo.liquidateCollateralFactor);
    expect(tETHAssetConfig.liquidationFactor).to.be.equal(cometTETHAssetInfo.liquidationFactor);
    expect(tETHAssetConfig.supplyCap).to.be.equal(cometTETHAssetInfo.supplyCap);

    const configuratorTETHAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[tETHAssetIndex];
    expect(tETHAssetConfig.asset).to.be.equal(configuratorTETHAssetConfig.asset);
    expect(tETHAssetConfig.decimals).to.be.equal(configuratorTETHAssetConfig.decimals);
    expect(tETHAssetConfig.borrowCollateralFactor).to.be.equal(configuratorTETHAssetConfig.borrowCollateralFactor);
    expect(tETHAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorTETHAssetConfig.liquidateCollateralFactor);
    expect(tETHAssetConfig.liquidationFactor).to.be.equal(configuratorTETHAssetConfig.liquidationFactor);
    expect(tETHAssetConfig.supplyCap).to.be.equal(configuratorTETHAssetConfig.supplyCap);
  },
});
