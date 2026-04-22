import { expect } from 'chai';
import { utils, Contract } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';
import { forkedHreForBase } from '../../../../plugins/scenario/utils/hreForBase';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';

const MAINNET_WETH_COMET = '0xA17581A9E3356d9A858b789D68B4d866e593aE94';
const MAINNET_WSTETH_COMET = '0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3';

let mainnetUsdcPriceFeedAddress: string;
let mainnetWethPriceFeedAddress: string;
let mainnetWstEthPriceFeedAddress: string;

let optimismPriceFeedAddress: string;
let arbitrumPriceFeedAddress: string;
let basePriceFeedAddress: string;
let lineaPriceFeedAddress: string;
let unichainPriceFeedAddress: string;

export default migration('1776768428_update_rseth_pricefeeds_across_all_l2', {
  async prepare(deploymentManager: DeploymentManager) {
    const _mainnetUsdcPriceFeed = await deploymentManager.deploy(
      'rsETH:priceFeed',
      'pricefeeds/ConstantPriceFeed.sol',
      [
        8, // decimals
        1  // constantPrice
      ],
      true
    );
    
    mainnetWethPriceFeedAddress = _mainnetUsdcPriceFeed.address;
    mainnetUsdcPriceFeedAddress = _mainnetUsdcPriceFeed.address;
    mainnetWstEthPriceFeedAddress = _mainnetUsdcPriceFeed.address;

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
      configurator,
      cometAdmin,
      comet,
      rsETH,
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
      // 1. Update the price feed for rsETH in the USDC market on Mainnet
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, rsETH.address, mainnetUsdcPriceFeedAddress],
      },
      // 2. Update the price feed for rsETH in the WETH market on mainnet
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [MAINNET_WETH_COMET, rsETH.address, mainnetWethPriceFeedAddress],
      },
      // 3. Update the price feed for rsETH in the stETH market on mainnet
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [MAINNET_WSTETH_COMET, rsETH.address, mainnetWstEthPriceFeedAddress],
      },
      // 4. Deploy and upgrade USDC Comet to a new version
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
      // 5. Deploy and upgrade WETH Comet to a new version 
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, MAINNET_WETH_COMET],
      },
      // 6. Deploy and upgrade stETH Comet to a new version 
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, MAINNET_WSTETH_COMET],
      },
      // 7. Optimism proposal
      {
        contract: opL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [opBridgeReceiver.address, opProposalData, 3_000_000]
      },
      // 8. Base proposal
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [baseBridgeReceiver.address, baseProposalData, 3_000_000]
      },
      // 9. Arbitrum proposal
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
      // 10. Linea proposal
      {
        contract: lineaMessageService,
        signature: 'sendMessage(address,uint256,bytes)',
        args: [lineaBridgeReceiver.address, 0, lineaProposalData],
      },
      // 11. Unichain proposal
      {
        contract: unichainL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [unichainBridgeReceiver.address, unichainProposalData, 3_000_000],
      },
    ];

    const description = `# Update rsETH price feeds across all markets

## Proposal summary

WOOF! proposes to update rsETH price feeds across all markets that have rsETH as collateral to a new version.

### New price feed details
The primary mechanism of the contract relies on the exchange rate provided by the Kelp contract, while enforcing minimum and maximum boundaries. These boundary parameters are managed by the Community multisig and may be adjusted at any time without a cooldown period.

Should the retrieved exchange rate fall below the prescribed minimum, the price feed will default to the minimum capped valuation. Conversely, if the exchange rate exceeds the maximum boundary, the feed will return the maximum capped valuation.

Additionally, the contract incorporates functionality to establish a custom constant price, which is exclusively controlled by the Community multisig. Consequently, the contract is capable of operating in one of two distinct modes:

1. Exchange rate valuation subject to minimum and maximum caps.
2. A manually defined, constant valuation.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1113).


## Proposal Actions

The seventh proposal action sends a message to the Optimism bridge receiver to update the price feed for rsETH in the WETH market.

The eighth proposal action sends a message to the Base bridge receiver to update the price feed for rsETH in the WETH market.

The ninth proposal action sends a message to the Arbitrum bridge receiver to update the price feed for rsETH in the WETH market.

The tenth proposal action sends a message to the Linea bridge receiver to update the price feed for rsETH in the WETH market.

The eleventh proposal action sends a message to the Unichain bridge receiver to update the price feed for rsETH in the WETH market.
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
    const {
      comet,
      rsETH
    } = await deploymentManager.getContracts();
    const cometAssetInfo = await comet.getAssetInfoByAddress(rsETH.address);

    expect(cometAssetInfo.priceFeed).to.equal(mainnetUsdcPriceFeedAddress);

    const cometWETH = new Contract(MAINNET_WETH_COMET, [
      'function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))',
    ], await deploymentManager.getSigner());

    const wethCometAssetInfo = await cometWETH.getAssetInfoByAddress(rsETH.address);
    expect(wethCometAssetInfo.priceFeed).to.equal(mainnetWethPriceFeedAddress);

    const wstEthComet = new Contract(MAINNET_WSTETH_COMET, [
      'function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))',
    ], await deploymentManager.getSigner());

    const wstEthCometAssetInfo = await wstEthComet.getAssetInfoByAddress(rsETH.address);
    expect(wstEthCometAssetInfo.priceFeed).to.equal(mainnetWstEthPriceFeedAddress);

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