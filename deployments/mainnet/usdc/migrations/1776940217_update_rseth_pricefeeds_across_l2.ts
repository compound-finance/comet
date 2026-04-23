import { expect } from 'chai';
import { utils } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';
import { forkedHreForBase } from '../../../../plugins/scenario/utils/hreForBase';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';

let optimismPriceFeedAddress: string;
let arbitrumPriceFeedAddress: string;
let basePriceFeedAddress: string;
let lineaPriceFeedAddress: string;
let unichainPriceFeedAddress: string;

export default migration('1776940217_update_rseth_pricefeeds_across_l2', {
  async prepare(deploymentManager: DeploymentManager) {
    // Optimism
    const opHre = await forkedHreForBase({ name: 'optimism-weth', network: 'optimism', deployment: 'weth' });
    const opDm = await deploymentManager.addBridgedDeploymentManager('optimism', 'weth', opHre);

    const optimismRsETHPriceFeed = await opDm.deploy(
      'wrsETH:priceFeed',
      'pricefeeds/ConstantPriceFeed.sol',
      [
        8, // decimals
        1  // constantPrice
      ],
      true
    );

    // Base
    const baseHre = await forkedHreForBase({ name: 'base-weth', network: 'base', deployment: 'weth' });
    const baseDm = await deploymentManager.addBridgedDeploymentManager('base', 'weth', baseHre);

    const baseRsETHPriceFeed = await baseDm.deploy(
      'wrsETH:priceFeed',
      'pricefeeds/ConstantPriceFeed.sol',
      [
        8, // decimals
        1  // constantPrice
      ],
      true
    );

    // Arbitrum
    const arbitrumHre = await forkedHreForBase({ name: 'arbitrum-weth', network: 'arbitrum', deployment: 'weth' });
    const arbitrumDm = await deploymentManager.addBridgedDeploymentManager('arbitrum', 'weth', arbitrumHre);

    const arbitrumRsETHPriceFeed = await arbitrumDm.deploy(
      'rsETH:priceFeed',
      'pricefeeds/ConstantPriceFeed.sol',
      [
        8, // decimals
        1  // constantPrice
      ],
      true
    );

    // Linea
    const lineaHre = await forkedHreForBase({ name: 'linea-weth', network: 'linea', deployment: 'weth' });
    const lineaDm = await deploymentManager.addBridgedDeploymentManager('linea', 'weth', lineaHre);

    const lineaRsETHPriceFeed = await lineaDm.deploy(
      'wrsETH:priceFeed',
      'pricefeeds/ConstantPriceFeed.sol',
      [
        8, // decimals
        1  // constantPrice
      ],
      true
    );

    // Unichain
    const unichainHre = await forkedHreForBase({ name: 'unichain-weth', network: 'unichain', deployment: 'weth' });
    const unichainDm = await deploymentManager.addBridgedDeploymentManager('unichain', 'weth', unichainHre);

    const unichainRsETHPriceFeed = await unichainDm.deploy(
      'rsETH:priceFeed',
      'pricefeeds/ConstantPriceFeed.sol',
      [
        8, // decimals
        1  // constantPrice
      ],
      true
    );

    optimismPriceFeedAddress = optimismRsETHPriceFeed.address;
    arbitrumPriceFeedAddress = arbitrumRsETHPriceFeed.address;
    basePriceFeedAddress = baseRsETHPriceFeed.address;
    lineaPriceFeedAddress = lineaRsETHPriceFeed.address;
    unichainPriceFeedAddress = unichainRsETHPriceFeed.address;

    return {};
  },

  async enact(deploymentManager: DeploymentManager) {

    const trace = deploymentManager.tracer();

    const {
      timelock,
      governor,
      opL1CrossDomainMessenger,
      baseL1CrossDomainMessenger,
      arbitrumInbox,
      lineaMessageService,
      unichainL1CrossDomainMessenger
    } = await deploymentManager.getContracts();

    // Optimism    
    // const opHre = await forkedHreForBase({ name: 'optimism-weth', network: 'optimism', deployment: 'weth' });
    // const opDm = await deploymentManager.addBridgedDeploymentManager('optimism', 'weth', opHre);
    const opDm = await deploymentManager.bridgedDeploymentManagers.get('optimism:weth') as DeploymentManager;
    const {
      bridgeReceiver : opBridgeReceiver,
      configurator: opConfigurator,
      cometAdmin: opCometAdmin,
      comet: opWethComet,
      wrsETH: opRsETH,
    } = await opDm.getContracts();

    const optimismUpdateAssetPriceFeedCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'address'], [opWethComet.address, opRsETH.address, optimismPriceFeedAddress]);
    const optimismDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [opConfigurator.address, opWethComet.address]);

    const opProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          opConfigurator.address,
          opCometAdmin.address,
        ],
        [
          0, 0,
        ],
        [
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          optimismUpdateAssetPriceFeedCalldata,
          optimismDeployAndUpgradeToCalldata
        ],
      ]
    );

    // Base
    // const baseHre = await forkedHreForBase({ name: 'base-weth', network: 'base', deployment: 'weth' });
    // const baseDm = await deploymentManager.addBridgedDeploymentManager('base', 'weth', baseHre);
    const baseDm = await deploymentManager.bridgedDeploymentManagers.get('base:weth') as DeploymentManager;
    const {
      bridgeReceiver : baseBridgeReceiver,
      configurator: baseConfigurator,
      cometAdmin: baseCometAdmin,
      comet: baseWethComet,
      wrsETH: baseRsETH,
    } = await baseDm.getContracts();

    const baseUpdateAssetPriceFeedCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'address'], [baseWethComet.address, baseRsETH.address, basePriceFeedAddress]);
    const baseDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [baseConfigurator.address, baseWethComet.address]);

    const baseProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          baseConfigurator.address,
          baseCometAdmin.address,
        ],
        [
          0, 0
        ],
        [
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          baseUpdateAssetPriceFeedCalldata,
          baseDeployAndUpgradeToCalldata
        ],
      ]
    );

    // Arbitrum
    // const arbitrumHre = await forkedHreForBase({ name: 'arbitrum-weth', network: 'arbitrum', deployment: 'weth' });
    // const arbitrumDm = await deploymentManager.addBridgedDeploymentManager('arbitrum', 'weth', arbitrumHre);
    const arbitrumDm = await deploymentManager.bridgedDeploymentManagers.get('arbitrum:weth') as DeploymentManager;
    const {
      bridgeReceiver: arbitrumBridgeReceiver,
      configurator: arbitrumConfigurator,
      cometAdmin: arbitrumCometAdmin,
      comet: arbitrumWethComet,
      timelock: arbitrumTimelock,
      rsETH: arbitrumRsETH,
    } = await arbitrumDm.getContracts();

    const arbitrumUpdateAssetPriceFeedCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'address'], [arbitrumWethComet.address, arbitrumRsETH.address, arbitrumPriceFeedAddress]);
    const arbitrumDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [arbitrumConfigurator.address, arbitrumWethComet.address]);

    const arbitrumProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          arbitrumConfigurator.address,
          arbitrumCometAdmin.address,
        ],
        [
          0, 0,
        ],
        [
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          arbitrumUpdateAssetPriceFeedCalldata,
          arbitrumDeployAndUpgradeToCalldata
        ],
      ]
    );
    const createRetryableTicketGasParams = await estimateL2Transaction(
      {
        from: applyL1ToL2Alias(timelock.address),
        to: arbitrumBridgeReceiver.address,
        data: arbitrumProposalData
      },
      arbitrumDm
    );

    // Linea
    // const lineaHre = await forkedHreForBase({ name: 'linea-weth', network: 'linea', deployment: 'weth' });
    // const lineaDm = await deploymentManager.addBridgedDeploymentManager('linea', 'weth', lineaHre);
    const lineaDm = await deploymentManager.bridgedDeploymentManagers.get('linea:weth') as DeploymentManager;
    const {
      bridgeReceiver: lineaBridgeReceiver,
      configurator: lineaConfigurator,
      cometAdmin: lineaCometAdmin,
      comet: lineaWethComet,
      wrsETH: lineaRsETH,
    } = await lineaDm.getContracts();

    const updateAssetPriceFeedCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'address'], [lineaWethComet.address, lineaRsETH.address, lineaPriceFeedAddress]);
    const lineaDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [lineaConfigurator.address, lineaWethComet.address]);

    const lineaProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          lineaConfigurator.address,
          lineaCometAdmin.address,
        ],
        [
          0, 0,
        ],
        [
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          updateAssetPriceFeedCalldata,
          lineaDeployAndUpgradeToCalldata
        ],
      ]
    );

    // Unichain
    // const unichainHre = await forkedHreForBase({ name: 'unichain-weth', network: 'unichain', deployment: 'weth' });
    // const unichainDm = await deploymentManager.addBridgedDeploymentManager('unichain', 'weth', unichainHre);
    const unichainDm = await deploymentManager.bridgedDeploymentManagers.get('unichain:weth') as DeploymentManager;
    const {
      bridgeReceiver: unichainBridgeReceiver,
      configurator: unichainConfigurator,
      cometAdmin: unichainCometAdmin,
      comet: unichainWethComet,
      rsETH: unichainRsETH,
    } = await unichainDm.getContracts();

    const unichainUpdateAssetPriceFeedCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'address'], [unichainWethComet.address, unichainRsETH.address, unichainPriceFeedAddress]);
    const unichainDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [unichainConfigurator.address, unichainWethComet.address]);

    const unichainProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          unichainConfigurator.address,
          unichainCometAdmin.address,
        ],
        [
          0, 0,
        ],
        [
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          unichainUpdateAssetPriceFeedCalldata,
          unichainDeployAndUpgradeToCalldata
        ],
      ]
    );

    const mainnetActions = [
      // 1. Optimism proposal
      {
        contract: opL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [opBridgeReceiver.address, opProposalData, 3_000_000]
      },
      // 2. Base proposal
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [baseBridgeReceiver.address, baseProposalData, 3_000_000]
      },
      // 3. Arbitrum proposal
      {
        contract: arbitrumInbox,
        signature: 'createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
        args: [
          arbitrumBridgeReceiver.address,                   // address to,
          0,                                                // uint256 l2CallValue,
          createRetryableTicketGasParams.maxSubmissionCost, // uint256 maxSubmissionCost,
          arbitrumTimelock.address,                         // address excessFeeRefundAddress,
          arbitrumTimelock.address,                         // address callValueRefundAddress,
          createRetryableTicketGasParams.gasLimit,          // uint256 gasLimit,
          createRetryableTicketGasParams.maxFeePerGas*2,    // uint256 maxFeePerGas,
          arbitrumProposalData,                             // bytes calldata data
        ],
        value: createRetryableTicketGasParams.deposit.mul(2),
      },
      // 4. Linea proposal
      {
        contract: lineaMessageService,
        signature: 'sendMessage(address,uint256,bytes)',
        args: [lineaBridgeReceiver.address, 0, lineaProposalData],
      },
      // 5. Unichain proposal
      {
        contract: unichainL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [unichainBridgeReceiver.address, unichainProposalData, 3_000_000],
      },
    ];

    const description = `# Update rsETH Price Feeds on WETH Markets (L2)

## Summary

It is proposed to migrate the rsETH price feeds on the Optimism, Base, Arbitrum, Linea, and Unichain WETH Comets to a new 'MinMaxConstantPriceFeed' contract. This follows [Gauntlet's proposal](<>) in response to the April 18 Kelp rsETH bridge exploit, and gives the Community Multisig a faster defensive lever than a full governance cycle.

This is intended as a temporary measure. Once the rsETH situation is resolved, a subsequent governance proposal will revert the price feeds to the prior configuration.

## New Price Feed

The new feed wraps the existing Kelp exchange rate and operates in one of two modes, set by the Community Multisig:

1. **Bounded exchange rate (default).** Passes the Kelp exchange rate through unchanged when it sits between configured 'min' and 'max' bounds. If the rate falls below 'min' or rises above 'max', the feed returns the bound. Setting 'min = 0' and 'max = ∞' reproduces the existing oracle behavior.
2. **Constant price.** Returns a fixed price set by the multisig, bypassing the underlying feed. Intended for cases where the exchange rate can no longer be trusted.

Bounds and mode changes are multisig-only, with no cooldown. A cursory review by SSPs was already performed and a final audit confirmation will be linked on the forum prior to proposal vote.

Implementation details: [PR #1113](https://github.com/compound-finance/comet/pull/1113).

## Proposal Actions

1. Send message to update the rsETH price feed on the Optimism WETH market.
2. Send message to update the rsETH price feed on the Base WETH market.
3. Send message to update the rsETH price feed on the Arbitrum WETH market.
4. Send message to update the rsETH price feed on the Linea WETH market.
5. Send message to update the rsETH price feed on the Unichain WETH market.

On execution, the liquidation pause on rsETH/wrsETH collateral in these markets will be lifted. A follow-up proposal will revert these markets to their prior price feed configuration once the incident is resolved.
`;

    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      ), 0, 600_000
    );

    const event = txn.events.find(
      (event: { event: string }) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    // Optimism
    const opDm = deploymentManager.bridgedDeploymentManagers.get('optimism:weth') as DeploymentManager;
    const {
      comet:optimismComet,
      wrsETH: optimismRsETH,
    } = await opDm.getContracts();

    const optimismCometAssetInfo = await optimismComet.getAssetInfoByAddress(optimismRsETH.address);

    expect(optimismCometAssetInfo.priceFeed).to.equal(optimismPriceFeedAddress);
    
    // Base
    const baseDm = deploymentManager.bridgedDeploymentManagers.get('base:weth') as DeploymentManager;
    const {
      comet: baseComet,
      wrsETH: baseRsETH,
    } = await baseDm.getContracts();

    const baseCometAssetInfo = await baseComet.getAssetInfoByAddress(baseRsETH.address);
    expect(baseCometAssetInfo.priceFeed).to.equal(basePriceFeedAddress);

    // Arbitrum
    const arbitrumDm = deploymentManager.bridgedDeploymentManagers.get('arbitrum:weth') as DeploymentManager;
    const {
      comet: arbitrumComet,
      rsETH: arbitrumRsETH,
    } = await arbitrumDm.getContracts();

    const arbitrumCometAssetInfo = await arbitrumComet.getAssetInfoByAddress(arbitrumRsETH.address);
    expect(arbitrumCometAssetInfo.priceFeed).to.equal(arbitrumPriceFeedAddress);

    // Linea
    const lineaDm = deploymentManager.bridgedDeploymentManagers.get('linea:weth') as DeploymentManager;
    const {
      comet: lineaComet,
      wrsETH: lineaRsETH,
    } = await lineaDm.getContracts();

    const lineaCometAssetInfo = await lineaComet.getAssetInfoByAddress(lineaRsETH.address);
    expect(lineaCometAssetInfo.priceFeed).to.equal(lineaPriceFeedAddress);
    
    // Unichain
    const unichainDm = deploymentManager.bridgedDeploymentManagers.get('unichain:weth') as DeploymentManager;
    const {
      comet: unichainComet,
      rsETH: unichainRsETH,
    } = await unichainDm.getContracts();

    const unichainCometAssetInfo = await unichainComet.getAssetInfoByAddress(unichainRsETH.address);
    expect(unichainCometAssetInfo.priceFeed).to.equal(unichainPriceFeedAddress);
  },
});
