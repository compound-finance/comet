import { expect } from 'chai';
import { BigNumber, utils } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';
import { forkedHreForBase } from '../../../../plugins/scenario/utils/hreForBase';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';

/*
Comet	Kink     Rate	 Max Rate
Base WETH	     1.50%	3.00%
Arbitrum WETH	 1.50%	3.00%
Optimism WETH	 1.50%	3.00%
Linea WETH	   1.50%	3.00%
Unichain WETH	 1.50%	3.00%

Params:

Optimism WETH changes
borrowPerYearInterestRateSlopeLow : 5555555555555555 
borrowPerYearInterestRateSlopeHigh : 150000000000000000 
supplyPerYearInterestRateSlopeLow : 15000000000000000 
supplyPerYearInterestRateSlopeHigh : 135000000000000000 

Base WETH changes
borrowPerYearInterestRateSlopeLow : 5555555555555555 
borrowPerYearInterestRateSlopeHigh : 150000000000000000 
supplyPerYearInterestRateSlopeLow : 15000000000000000 
supplyPerYearInterestRateSlopeHigh : 135000000000000000 

Arbitrum WETH changes
borrowPerYearInterestRateSlopeLow : 5555555555555555 
borrowPerYearInterestRateSlopeHigh : 150000000000000000 
supplyPerYearInterestRateSlopeLow : 15000000000000000 
supplyPerYearInterestRateSlopeHigh : 135000000000000000 

Linea WETH changes
borrowPerYearInterestRateSlopeLow : 5555555555555555 
borrowPerYearInterestRateSlopeHigh : 150000000000000000 
supplyPerYearInterestRateSlopeLow : 15000000000000000 
supplyPerYearInterestRateSlopeHigh : 135000000000000000 

Unichain WETH changes
borrowPerYearInterestRateSlopeLow : 5555555555555555 
borrowPerYearInterestRateSlopeHigh : 150000000000000000 
supplyPerYearInterestRateSlopeLow : 15000000000000000 
supplyPerYearInterestRateSlopeHigh : 135000000000000000

*/
const borrowPerYearInterestRateSlopeLow = '5555555555555555';
const borrowPerYearInterestRateSlopeHigh = '150000000000000000';

const supplyPerYearInterestRateSlopeLow = '15000000000000000';
const supplyPerYearInterestRateSlopeHigh = '135000000000000000';

let expectedBorrowPerSecondInterestRateSlopeLow: BigNumber;
let expectedBorrowPerSecondInterestRateSlopeHigh: BigNumber;

let expectedSupplyPerSecondInterestRateSlopeLow: BigNumber;
let expectedSupplyPerSecondInterestRateSlopeHigh: BigNumber;

export default migration('1776768296_update_curve_params_on_l2', {
  async prepare() {
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

    expectedBorrowPerSecondInterestRateSlopeLow = BigNumber.from(borrowPerYearInterestRateSlopeLow).div(365 * 86400);
    expectedBorrowPerSecondInterestRateSlopeHigh = BigNumber.from(borrowPerYearInterestRateSlopeHigh).div(365 * 86400);

    expectedSupplyPerSecondInterestRateSlopeLow = BigNumber.from(supplyPerYearInterestRateSlopeLow).div(365 * 86400);
    expectedSupplyPerSecondInterestRateSlopeHigh = BigNumber.from(supplyPerYearInterestRateSlopeHigh).div(365 * 86400);

    // Optimism
    const opHre = await forkedHreForBase({ name: 'optimism-weth', network: 'optimism', deployment: 'weth' });
    const opDm = await deploymentManager.addBridgedDeploymentManager('optimism', 'weth', opHre);
    const {
      bridgeReceiver : opBridgeReceiver,
      configurator: opConfigurator,
      cometAdmin: opCometAdmin,
      comet: opWethComet,
    } = await opDm.getContracts();

    const optimismSetBorrowPerYearInterestRateSlopeLowCalldata = utils.defaultAbiCoder.encode(['address', 'uint64'], [opWethComet.address, borrowPerYearInterestRateSlopeLow]);
    const optimismSetBorrowPerYearInterestRateSlopeHighCalldata = utils.defaultAbiCoder.encode(['address', 'uint64'], [opWethComet.address, borrowPerYearInterestRateSlopeHigh]);
    const optimismSetSupplyPerYearInterestRateSlopeLowCalldata = utils.defaultAbiCoder.encode(['address', 'uint64'], [opWethComet.address, supplyPerYearInterestRateSlopeLow]);
    const optimismSetSupplyPerYearInterestRateSlopeHighCalldata = utils.defaultAbiCoder.encode(['address', 'uint64'], [opWethComet.address, supplyPerYearInterestRateSlopeHigh]);
    const optimismDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [opConfigurator.address, opWethComet.address]);

    const opProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          opConfigurator.address, opConfigurator.address,
          opConfigurator.address, opConfigurator.address,
          opCometAdmin.address,
        ],
        [
          0, 0,
          0, 0,
          0
        ],
        [
          'setBorrowPerYearInterestRateSlopeLow(address,uint64)',
          'setBorrowPerYearInterestRateSlopeHigh(address,uint64)',
          'setSupplyPerYearInterestRateSlopeLow(address,uint64)',
          'setSupplyPerYearInterestRateSlopeHigh(address,uint64)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          optimismSetBorrowPerYearInterestRateSlopeLowCalldata, optimismSetBorrowPerYearInterestRateSlopeHighCalldata,
          optimismSetSupplyPerYearInterestRateSlopeLowCalldata, optimismSetSupplyPerYearInterestRateSlopeHighCalldata,
          optimismDeployAndUpgradeToCalldata
        ],
      ]
    );

    // Base
    const baseHre = await forkedHreForBase({ name: 'base-weth', network: 'base', deployment: 'weth' });
    const baseDm = await deploymentManager.addBridgedDeploymentManager('base', 'weth', baseHre);
    const {
      bridgeReceiver : baseBridgeReceiver,
      configurator: baseConfigurator,
      cometAdmin: baseCometAdmin,
      comet: baseWethComet,
    } = await baseDm.getContracts();

    const baseSetBorrowPerYearInterestRateSlopeLowCalldata = utils.defaultAbiCoder.encode(['address', 'uint64'], [baseWethComet.address, borrowPerYearInterestRateSlopeLow]);
    const baseSetBorrowPerYearInterestRateSlopeHighCalldata = utils.defaultAbiCoder.encode(['address', 'uint64'], [baseWethComet.address, borrowPerYearInterestRateSlopeHigh]);
    const baseSetSupplyPerYearInterestRateSlopeLowCalldata = utils.defaultAbiCoder.encode(['address', 'uint64'], [baseWethComet.address, supplyPerYearInterestRateSlopeLow]);
    const baseSetSupplyPerYearInterestRateSlopeHighCalldata = utils.defaultAbiCoder.encode(['address', 'uint64'], [baseWethComet.address, supplyPerYearInterestRateSlopeHigh]);
    const baseDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [baseConfigurator.address, baseWethComet.address]);

    const baseProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          baseConfigurator.address, baseConfigurator.address,
          baseConfigurator.address, baseConfigurator.address,
          baseCometAdmin.address,
        ],
        [
          0, 0,
          0, 0,
          0
        ],
        [
          'setBorrowPerYearInterestRateSlopeLow(address,uint64)',
          'setBorrowPerYearInterestRateSlopeHigh(address,uint64)',
          'setSupplyPerYearInterestRateSlopeLow(address,uint64)',
          'setSupplyPerYearInterestRateSlopeHigh(address,uint64)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          baseSetBorrowPerYearInterestRateSlopeLowCalldata, baseSetBorrowPerYearInterestRateSlopeHighCalldata,
          baseSetSupplyPerYearInterestRateSlopeLowCalldata, baseSetSupplyPerYearInterestRateSlopeHighCalldata,
          baseDeployAndUpgradeToCalldata
        ],
      ]
    );

    // Arbitrum
    const arbitrumHre = await forkedHreForBase({ name: 'arbitrum-weth', network: 'arbitrum', deployment: 'weth' });
    const arbitrumDm = await deploymentManager.addBridgedDeploymentManager('arbitrum', 'weth', arbitrumHre);
    const {
      bridgeReceiver: arbitrumBridgeReceiver,
      configurator: arbitrumConfigurator,
      cometAdmin: arbitrumCometAdmin,
      comet: arbitrumWethComet,
      timelock: arbitrumTimelock,
    } = await arbitrumDm.getContracts();

    const arbitrumSetBorrowPerYearInterestRateSlopeLowCalldata = utils.defaultAbiCoder.encode(['address', 'uint64'], [arbitrumWethComet.address, borrowPerYearInterestRateSlopeLow]);
    const arbitrumSetBorrowPerYearInterestRateSlopeHighCalldata = utils.defaultAbiCoder.encode(['address', 'uint64'], [arbitrumWethComet.address, borrowPerYearInterestRateSlopeHigh]);
    const arbitrumSetSupplyPerYearInterestRateSlopeLowCalldata = utils.defaultAbiCoder.encode(['address', 'uint64'], [arbitrumWethComet.address, supplyPerYearInterestRateSlopeLow]);
    const arbitrumSetSupplyPerYearInterestRateSlopeHighCalldata = utils.defaultAbiCoder.encode(['address', 'uint64'], [arbitrumWethComet.address, supplyPerYearInterestRateSlopeHigh]);
    const arbitrumDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [arbitrumConfigurator.address, arbitrumWethComet.address]);

    const arbitrumProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          arbitrumConfigurator.address, arbitrumConfigurator.address,
          arbitrumConfigurator.address, arbitrumConfigurator.address,
          arbitrumCometAdmin.address,
        ],
        [
          0, 0,
          0, 0,
          0
        ],
        [
          'setBorrowPerYearInterestRateSlopeLow(address,uint64)',
          'setBorrowPerYearInterestRateSlopeHigh(address,uint64)',
          'setSupplyPerYearInterestRateSlopeLow(address,uint64)',
          'setSupplyPerYearInterestRateSlopeHigh(address,uint64)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          arbitrumSetBorrowPerYearInterestRateSlopeLowCalldata, arbitrumSetBorrowPerYearInterestRateSlopeHighCalldata,
          arbitrumSetSupplyPerYearInterestRateSlopeLowCalldata, arbitrumSetSupplyPerYearInterestRateSlopeHighCalldata,
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
    const lineaHre = await forkedHreForBase({ name: 'linea-weth', network: 'linea', deployment: 'weth' });
    const lineaDm = await deploymentManager.addBridgedDeploymentManager('linea', 'weth', lineaHre);
    const {
      bridgeReceiver: lineaBridgeReceiver,
      configurator: lineaConfigurator,
      cometAdmin: lineaCometAdmin,
      comet: lineaWethComet,
    } = await lineaDm.getContracts();

    const lineaSetBorrowPerYearInterestRateSlopeLowCalldata = utils.defaultAbiCoder.encode(['address', 'uint64'], [lineaWethComet.address, borrowPerYearInterestRateSlopeLow]);
    const lineaSetBorrowPerYearInterestRateSlopeHighCalldata = utils.defaultAbiCoder.encode(['address', 'uint64'], [lineaWethComet.address, borrowPerYearInterestRateSlopeHigh]);
    const lineaSetSupplyPerYearInterestRateSlopeLowCalldata = utils.defaultAbiCoder.encode(['address', 'uint64'], [lineaWethComet.address, supplyPerYearInterestRateSlopeLow]);
    const lineaSetSupplyPerYearInterestRateSlopeHighCalldata = utils.defaultAbiCoder.encode(['address', 'uint64'], [lineaWethComet.address, supplyPerYearInterestRateSlopeHigh]);
    const lineaDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [lineaConfigurator.address, lineaWethComet.address]);

    const lineaProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          lineaConfigurator.address, lineaConfigurator.address,
          lineaConfigurator.address, lineaConfigurator.address,
          lineaCometAdmin.address,
        ],
        [
          0, 0,
          0, 0,
          0
        ],
        [
          'setBorrowPerYearInterestRateSlopeLow(address,uint64)',
          'setBorrowPerYearInterestRateSlopeHigh(address,uint64)',
          'setSupplyPerYearInterestRateSlopeLow(address,uint64)',
          'setSupplyPerYearInterestRateSlopeHigh(address,uint64)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          lineaSetBorrowPerYearInterestRateSlopeLowCalldata, lineaSetBorrowPerYearInterestRateSlopeHighCalldata,
          lineaSetSupplyPerYearInterestRateSlopeLowCalldata, lineaSetSupplyPerYearInterestRateSlopeHighCalldata,
          lineaDeployAndUpgradeToCalldata
        ],
      ]
    );

    // Unichain
    const unichainHre = await forkedHreForBase({ name: 'unichain-weth', network: 'unichain', deployment: 'weth' });
    const unichainDm = await deploymentManager.addBridgedDeploymentManager('unichain', 'weth', unichainHre);
    const {
      bridgeReceiver: unichainBridgeReceiver,
      configurator: unichainConfigurator,
      cometAdmin: unichainCometAdmin,
      comet: unichainWethComet,
    } = await unichainDm.getContracts();

    const unichainSetBorrowPerYearInterestRateSlopeLowCalldata = utils.defaultAbiCoder.encode(['address', 'uint64'], [unichainWethComet.address, borrowPerYearInterestRateSlopeLow]);
    const unichainSetBorrowPerYearInterestRateSlopeHighCalldata = utils.defaultAbiCoder.encode(['address', 'uint64'], [unichainWethComet.address, borrowPerYearInterestRateSlopeHigh]);
    const unichainSetSupplyPerYearInterestRateSlopeLowCalldata = utils.defaultAbiCoder.encode(['address', 'uint64'], [unichainWethComet.address, supplyPerYearInterestRateSlopeLow]);
    const unichainSetSupplyPerYearInterestRateSlopeHighCalldata = utils.defaultAbiCoder.encode(['address', 'uint64'], [unichainWethComet.address, supplyPerYearInterestRateSlopeHigh]);
    const unichainDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [unichainConfigurator.address, unichainWethComet.address]);

    const unichainProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          unichainConfigurator.address, unichainConfigurator.address,
          unichainConfigurator.address, unichainConfigurator.address,
          unichainCometAdmin.address,
        ],
        [
          0, 0,
          0, 0,
          0
        ],
        [
          'setBorrowPerYearInterestRateSlopeLow(address,uint64)',
          'setBorrowPerYearInterestRateSlopeHigh(address,uint64)',
          'setSupplyPerYearInterestRateSlopeLow(address,uint64)',
          'setSupplyPerYearInterestRateSlopeHigh(address,uint64)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          unichainSetBorrowPerYearInterestRateSlopeLowCalldata, unichainSetBorrowPerYearInterestRateSlopeHighCalldata,
          unichainSetSupplyPerYearInterestRateSlopeLowCalldata, unichainSetSupplyPerYearInterestRateSlopeHighCalldata,
          unichainDeployAndUpgradeToCalldata
        ],
      ]
    );



    const mainnetActions = [
      // Optimism proposal
      {
        contract: opL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [opBridgeReceiver.address, opProposalData, 3_000_000]
      },
      // Base proposal
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [baseBridgeReceiver.address, baseProposalData, 3_000_000]
      },
      // Arbitrum proposal
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
      // Linea proposal
      {
        contract: lineaMessageService,
        signature: 'sendMessage(address,uint256,bytes)',
        args: [lineaBridgeReceiver.address, 0, lineaProposalData],
      },
      // Unichain proposal
      {
        contract: unichainL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [unichainBridgeReceiver.address, unichainProposalData, 3_000_000],
      },
    ];

    const description = `# WETH Comets Interest Rate Curve Recommendations on L2 networks

## Simple Summary

Given heightened market activity and elevated volatility across ETH markets Gauntlet recommends the following Interest Rate (IR) Curve updates across WETH comets on Ethereum. These changes are designed to keep borrow costs low and avoid liquidations during the volatile period.

## Motivation
The recent Kelp exploit has led to heightened volatility and shifting dynamics across ETH-correlated assets. In this environment LST/LRT-based looping strategies are facing a significantly high negative carry. The recommendations below flatten the slope below kink and compress the slope above kink resulting in lower kink and max borrow rates across all WETH markets.

The intent is to:
* Keep Compound’s WETH borrow rates not too high so that unwinding can happen gradually in a volatile environment.
* Decrease existing borrow positions gradually without pushing rates to a level that would unwind a high amount of the existing ETH-leverage positions. We will continue to monitor utilization and reserve growth and will adjust as conditions evolve.

## Specification
Target APRs at kink and at 100% utilization across the comets:
| Comet | Kink Rate | Max Rate |
| --------------- | --------- | -------- |
| Base WETH | 1.50% | 3.00% |
| Arbitrum WETH | 1.50% | 3.00% |
| Optimism WETH | 1.50% | 3.00% |
| Linea WETH | 1.50% | 3.00% |
| Unichain WETH | 1.50% | 3.00% |
Borrow kink is held at 90% across all markets. The base rate is held constant at current values. Slope Low and Slope High are updated to achieve the target kink and max rates above. [Forum Post](https://www.comp.xyz/t/weth-comet-interest-rate-curve-recommendations/7749)`;

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
    const { comet } = await opDm.getContracts();

    const currentBorrowPerSecondInterestRateSlopeLow = await comet.borrowPerSecondInterestRateSlopeLow();
    const currentBorrowPerSecondInterestRateSlopeHigh = await comet.borrowPerSecondInterestRateSlopeHigh();

    const currentSupplyPerSecondInterestRateSlopeLow = await comet.supplyPerSecondInterestRateSlopeLow();
    const currentSupplyPerSecondInterestRateSlopeHigh = await comet.supplyPerSecondInterestRateSlopeHigh();

    expect(currentBorrowPerSecondInterestRateSlopeLow.toString()).to.equal(expectedBorrowPerSecondInterestRateSlopeLow.toString());
    expect(currentBorrowPerSecondInterestRateSlopeHigh.toString()).to.equal(expectedBorrowPerSecondInterestRateSlopeHigh.toString());

    expect(currentSupplyPerSecondInterestRateSlopeLow.toString()).to.equal(expectedSupplyPerSecondInterestRateSlopeLow.toString());
    expect(currentSupplyPerSecondInterestRateSlopeHigh.toString()).to.equal(expectedSupplyPerSecondInterestRateSlopeHigh.toString());
    
    // Base
    const baseDm = deploymentManager.bridgedDeploymentManagers.get('base:weth') as DeploymentManager;
    const { comet: baseComet } = await baseDm.getContracts();

    const baseCurrentBorrowPerSecondInterestRateSlopeLow = await baseComet.borrowPerSecondInterestRateSlopeLow();
    const baseCurrentBorrowPerSecondInterestRateSlopeHigh = await baseComet.borrowPerSecondInterestRateSlopeHigh();

    const baseCurrentSupplyPerSecondInterestRateSlopeLow = await baseComet.supplyPerSecondInterestRateSlopeLow();
    const baseCurrentSupplyPerSecondInterestRateSlopeHigh = await baseComet.supplyPerSecondInterestRateSlopeHigh();

    expect(baseCurrentBorrowPerSecondInterestRateSlopeLow.toString()).to.equal(expectedBorrowPerSecondInterestRateSlopeLow.toString());
    expect(baseCurrentBorrowPerSecondInterestRateSlopeHigh.toString()).to.equal(expectedBorrowPerSecondInterestRateSlopeHigh.toString());

    expect(baseCurrentSupplyPerSecondInterestRateSlopeLow.toString()).to.equal(expectedSupplyPerSecondInterestRateSlopeLow.toString());
    expect(baseCurrentSupplyPerSecondInterestRateSlopeHigh.toString()).to.equal(expectedSupplyPerSecondInterestRateSlopeHigh.toString());

    // Arbitrum
    const arbitrumDm = deploymentManager.bridgedDeploymentManagers.get('arbitrum:weth') as DeploymentManager;
    const { comet: arbitrumComet } = await arbitrumDm.getContracts();

    const arbitrumCurrentBorrowPerSecondInterestRateSlopeLow = await arbitrumComet.borrowPerSecondInterestRateSlopeLow();
    const arbitrumCurrentBorrowPerSecondInterestRateSlopeHigh = await arbitrumComet.borrowPerSecondInterestRateSlopeHigh();

    const arbitrumCurrentSupplyPerSecondInterestRateSlopeLow = await arbitrumComet.supplyPerSecondInterestRateSlopeLow();
    const arbitrumCurrentSupplyPerSecondInterestRateSlopeHigh = await arbitrumComet.supplyPerSecondInterestRateSlopeHigh();

    expect(arbitrumCurrentBorrowPerSecondInterestRateSlopeLow.toString()).to.equal(expectedBorrowPerSecondInterestRateSlopeLow.toString());
    expect(arbitrumCurrentBorrowPerSecondInterestRateSlopeHigh.toString()).to.equal(expectedBorrowPerSecondInterestRateSlopeHigh.toString());

    expect(arbitrumCurrentSupplyPerSecondInterestRateSlopeLow.toString()).to.equal(expectedSupplyPerSecondInterestRateSlopeLow.toString());
    expect(arbitrumCurrentSupplyPerSecondInterestRateSlopeHigh.toString()).to.equal(expectedSupplyPerSecondInterestRateSlopeHigh.toString());

    // Linea
    const lineaDm = deploymentManager.bridgedDeploymentManagers.get('linea:weth') as DeploymentManager;
    const { comet: lineaComet } = await lineaDm.getContracts();

    const lineaCurrentBorrowPerSecondInterestRateSlopeLow = await lineaComet.borrowPerSecondInterestRateSlopeLow();
    const lineaCurrentBorrowPerSecondInterestRateSlopeHigh = await lineaComet.borrowPerSecondInterestRateSlopeHigh();

    const lineaCurrentSupplyPerSecondInterestRateSlopeLow = await lineaComet.supplyPerSecondInterestRateSlopeLow();
    const lineaCurrentSupplyPerSecondInterestRateSlopeHigh = await lineaComet.supplyPerSecondInterestRateSlopeHigh();

    expect(lineaCurrentBorrowPerSecondInterestRateSlopeLow.toString()).to.equal(expectedBorrowPerSecondInterestRateSlopeLow.toString());
    expect(lineaCurrentBorrowPerSecondInterestRateSlopeHigh.toString()).to.equal(expectedBorrowPerSecondInterestRateSlopeHigh.toString());

    expect(lineaCurrentSupplyPerSecondInterestRateSlopeLow.toString()).to.equal(expectedSupplyPerSecondInterestRateSlopeLow.toString());
    expect(lineaCurrentSupplyPerSecondInterestRateSlopeHigh.toString()).to.equal(expectedSupplyPerSecondInterestRateSlopeHigh.toString());

    // Unichain
    const unichainDm = deploymentManager.bridgedDeploymentManagers.get('unichain:weth') as DeploymentManager;
    const { comet: unichainComet } = await unichainDm.getContracts();

    const unichainCurrentBorrowPerSecondInterestRateSlopeLow = await unichainComet.borrowPerSecondInterestRateSlopeLow();
    const unichainCurrentBorrowPerSecondInterestRateSlopeHigh = await unichainComet.borrowPerSecondInterestRateSlopeHigh();

    const unichainCurrentSupplyPerSecondInterestRateSlopeLow = await unichainComet.supplyPerSecondInterestRateSlopeLow();
    const unichainCurrentSupplyPerSecondInterestRateSlopeHigh = await unichainComet.supplyPerSecondInterestRateSlopeHigh();

    expect(unichainCurrentBorrowPerSecondInterestRateSlopeLow.toString()).to.equal(expectedBorrowPerSecondInterestRateSlopeLow.toString());
    expect(unichainCurrentBorrowPerSecondInterestRateSlopeHigh.toString()).to.equal(expectedBorrowPerSecondInterestRateSlopeHigh.toString());

    expect(unichainCurrentSupplyPerSecondInterestRateSlopeLow.toString()).to.equal(expectedSupplyPerSecondInterestRateSlopeLow.toString());
    expect(unichainCurrentSupplyPerSecondInterestRateSlopeHigh.toString()).to.equal(expectedSupplyPerSecondInterestRateSlopeHigh.toString());
  },
});