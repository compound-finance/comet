import { expect } from 'chai';
import { Contract, utils } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';

/*
// Arbitrum

Arbitrum USDC Comet
Symbol	Current Cap	Supply Balance	Utilization	Proposed Cap	Rule
tETH	50	0	0.26%	0	Rule 1
tBTC	40	1	3.23%	0	Rule 1 (see note)
ezETH	1,400	78	5.59%	102	Rule 2 (~31% buffer)
GMX	120,000	1,997	1.66%	2,596	Rule 2 (~30% buffer)
ARB	16,000,000	1,497,565	9.36%	1,946,834	Rule 2 (~30% buffer)

Arbitrum USDC.e Comet
Symbol	Current Cap	Supply Balance	Utilization	Proposed Cap	Rule
GMX	25,000	3	0.01%	0	Rule 1
ARB	2,000,000	22,962	1.15%	29,851	Rule 2 (~30% buffer)

Arbitrum USDT Comet
Symbol	Current Cap	Supply Balance	Utilization	Proposed Cap	Rule
tETH	25	0	0.01%	0	Rule 1
tBTC	80	2	2.68%	3	Rule 2 (integer-rounded buffer)
GMX	50,000	2,099	4.20%	2,729	Rule 2 (~30% buffer)
ARB	7,500,000	349,311	4.66%	454,105	Rule 2 (~30% buffer)

Arbitrum WETH Comet
Symbol	Current Cap	Supply Balance	Utilization	Proposed Cap	Rule
tETH	25	0	0.61%	0	Rule 1
rETH	3,750	5	0.14%	0	Rule 1
weETH	24,000	585	2.44%	760	Rule 2 (~30% buffer)
ezETH	12,000	447	3.73%	582	Rule 2 (~30% buffer)

*/

const cometConfig = {
  Arbitrum: {
    USDC: {
      address: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf',
    },
    USDCe: {
      address: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA',
    },
    USDT: {
      address: '0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07',
    },
    WETH: {
      address: '0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486',
    },
  },
};

const supplyCapConfig = {
  Arbitrum: {
    USDC: {
      tETH: {
        newCap: 0,
        decimals: 18,
      },
      tBTC: {
        newCap: 0,
        decimals: 18,
      },
      ezETH: {
        newCap: 102,
        decimals: 18,
      },
      GMX: {
        newCap: 2_596,
        decimals: 18,
      },
      ARB: {
        newCap: 1_946_834,
        decimals: 18,
      },
    },
    USDCe: {
      GMX: {
        newCap: 0,
        decimals: 18,
      },
      ARB: {
        newCap: 29_851,
        decimals: 18,
      },
    },
    USDT: {
      tETH: {
        newCap: 0,
        decimals: 18,
      },
      tBTC: {
        newCap: 3,
        decimals: 18,
      },
      GMX: {
        newCap: 2_729,
        decimals: 18,
      },
      ARB: {
        newCap: 454_105,
        decimals: 18,
      },
    },
    WETH: {
      tETH: {
        newCap: 0,
        decimals: 18,
      },
      rETH: {
        newCap: 0,
        decimals: 18,
      },
      weETH: {
        newCap: 760,
        decimals: 18,
      },
      ezETH: {
        newCap: 582,
        decimals: 18,
      },
    },
  },
};


export default migration('1778758319_update_supply_caps_on_l2', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager) {

    const trace = deploymentManager.tracer();

    const {
      timelock,
      governor,
      arbitrumInbox,
    } = await govDeploymentManager.getContracts();

    // Arbitrum
    const arbitrumDm = await govDeploymentManager.addBridgedDeploymentManager('arbitrum', 'usdc', deploymentManager.hre);
    const {
      bridgeReceiver: arbitrumBridgeReceiver,
      configurator: arbitrumConfigurator,
      cometAdmin: arbitrumCometAdmin,
      tETH: arbitrumTETH,
      tBTC: arbitrumTBTC,
      ezETH: arbitrumEZETH,
      GMX: arbitrumGMX,
      ARB: arbitrumARB,
      timelock: arbitrumTimelock,
    } = await arbitrumDm.getContracts();

    const arbitrumUsdcUpdateTETHSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Arbitrum.USDC.address, arbitrumTETH.address, exp(supplyCapConfig.Arbitrum.USDC.tETH.newCap, supplyCapConfig.Arbitrum.USDC.tETH.decimals)]);
    const arbitrumUsdcUpdateTBTCSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Arbitrum.USDC.address, arbitrumTBTC.address, exp(supplyCapConfig.Arbitrum.USDC.tBTC.newCap, supplyCapConfig.Arbitrum.USDC.tBTC.decimals)]);
    const arbitrumUsdcUpdateEZETHSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Arbitrum.USDC.address, arbitrumEZETH.address, exp(supplyCapConfig.Arbitrum.USDC.ezETH.newCap, supplyCapConfig.Arbitrum.USDC.ezETH.decimals)]);
    const arbitrumUsdcUpdateGMXSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Arbitrum.USDC.address, arbitrumGMX.address, exp(supplyCapConfig.Arbitrum.USDC.GMX.newCap, supplyCapConfig.Arbitrum.USDC.GMX.decimals)]);
    const arbitrumUsdcUpdateARBSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Arbitrum.USDC.address, arbitrumARB.address, exp(supplyCapConfig.Arbitrum.USDC.ARB.newCap, supplyCapConfig.Arbitrum.USDC.ARB.decimals)]);
    const arbitrumUsdcDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [arbitrumConfigurator.address, cometConfig.Arbitrum.USDC.address]);

    const arbitrumUsdceUpdateGMXSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Arbitrum.USDCe.address, arbitrumGMX.address, exp(supplyCapConfig.Arbitrum.USDCe.GMX.newCap, supplyCapConfig.Arbitrum.USDCe.GMX.decimals)]);
    const arbitrumUsdceUpdateARBSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Arbitrum.USDCe.address, arbitrumARB.address, exp(supplyCapConfig.Arbitrum.USDCe.ARB.newCap, supplyCapConfig.Arbitrum.USDCe.ARB.decimals)]);
    const arbitrumUsdceDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [arbitrumConfigurator.address, cometConfig.Arbitrum.USDCe.address]);

    const arbitrumProposalData1 = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          // USDC Comet
          arbitrumConfigurator.address, // tETH
          arbitrumConfigurator.address, // tBTC
          arbitrumConfigurator.address, // ezETH
          arbitrumConfigurator.address, // GMX          
          arbitrumConfigurator.address, // ARB
          arbitrumCometAdmin.address,
          // USDC.e Comet
          arbitrumConfigurator.address, // GMX
          arbitrumConfigurator.address, // ARB
          arbitrumCometAdmin.address,
        ],
        [
          // USDC Comet
          0, // tETH
          0, // tBTC
          0, // ezETH
          0, // GMX
          0, // ARB
          0,
          // USDC.e Comet
          0, // GMX
          0, // ARB
          0,
        ],
        [
          // USDC Comet
          'updateAssetSupplyCap(address,address,uint128)', // tETH
          'updateAssetSupplyCap(address,address,uint128)', // tBTC
          'updateAssetSupplyCap(address,address,uint128)', // ezETH
          'updateAssetSupplyCap(address,address,uint128)', // GMX
          'updateAssetSupplyCap(address,address,uint128)', // ARB
          'deployAndUpgradeTo(address,address)',
          // USDC.e Comet
          'updateAssetSupplyCap(address,address,uint128)', // GMX
          'updateAssetSupplyCap(address,address,uint128)', // ARB
          'deployAndUpgradeTo(address,address)',
        ],
        [
          // USDC Comet
          arbitrumUsdcUpdateTETHSupplyCapCalldata,
          arbitrumUsdcUpdateTBTCSupplyCapCalldata,
          arbitrumUsdcUpdateEZETHSupplyCapCalldata,
          arbitrumUsdcUpdateGMXSupplyCapCalldata,
          arbitrumUsdcUpdateARBSupplyCapCalldata,
          arbitrumUsdcDeployAndUpgradeToCalldata,
          // USDC.e Comet
          arbitrumUsdceUpdateGMXSupplyCapCalldata,
          arbitrumUsdceUpdateARBSupplyCapCalldata,
          arbitrumUsdceDeployAndUpgradeToCalldata,
        ],
      ]
    );
    const createRetryableTicketGasParams1 = await estimateL2Transaction(
      {
        from: applyL1ToL2Alias(timelock.address),
        to: arbitrumBridgeReceiver.address,
        data: arbitrumProposalData1
      },
      arbitrumDm
    );

    const arbitrumUsdtUpdateTETHSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Arbitrum.USDT.address, arbitrumTETH.address, exp(supplyCapConfig.Arbitrum.USDT.tETH.newCap, supplyCapConfig.Arbitrum.USDT.tETH.decimals)]);
    const arbitrumUsdtUpdateTBTCSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Arbitrum.USDT.address, arbitrumTBTC.address, exp(supplyCapConfig.Arbitrum.USDT.tBTC.newCap, supplyCapConfig.Arbitrum.USDT.tBTC.decimals)]);
    const arbitrumUsdtUpdateGMXSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Arbitrum.USDT.address, arbitrumGMX.address, exp(supplyCapConfig.Arbitrum.USDT.GMX.newCap, supplyCapConfig.Arbitrum.USDT.GMX.decimals)]);
    const arbitrumUsdtUpdateARBSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Arbitrum.USDT.address, arbitrumARB.address, exp(supplyCapConfig.Arbitrum.USDT.ARB.newCap, supplyCapConfig.Arbitrum.USDT.ARB.decimals)]);
    const arbitrumUsdtDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [arbitrumConfigurator.address, cometConfig.Arbitrum.USDT.address]);

    const arbitrumDmWeth = await govDeploymentManager.addBridgedDeploymentManager('arbitrum', 'weth', deploymentManager.hre);
    const {
      rETH: arbitrumRETH,
      weETH: arbitrumWeETH,
      ezETH: arbitrumEzETH,
    } = await arbitrumDmWeth.getContracts();

    const arbitrumWethUpdateTETHSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Arbitrum.WETH.address, arbitrumTETH.address, exp(supplyCapConfig.Arbitrum.WETH.tETH.newCap, supplyCapConfig.Arbitrum.WETH.tETH.decimals)]);
    const arbitrumWethUpdateRETHSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Arbitrum.WETH.address, arbitrumRETH.address, exp(supplyCapConfig.Arbitrum.WETH.rETH.newCap, supplyCapConfig.Arbitrum.WETH.rETH.decimals)]);
    const arbitrumWethUpdateWeETHSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Arbitrum.WETH.address, arbitrumWeETH.address, exp(supplyCapConfig.Arbitrum.WETH.weETH.newCap, supplyCapConfig.Arbitrum.WETH.weETH.decimals)]);
    const arbitrumWethUpdateEzETHSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Arbitrum.WETH.address, arbitrumEzETH.address, exp(supplyCapConfig.Arbitrum.WETH.ezETH.newCap, supplyCapConfig.Arbitrum.WETH.ezETH.decimals)]);
    const arbitrumWethDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [arbitrumConfigurator.address, cometConfig.Arbitrum.WETH.address]);

    const arbitrumProposalData2 = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
        // USDT Comet
          arbitrumConfigurator.address, // tETH
          arbitrumConfigurator.address, // tBTC
          arbitrumConfigurator.address, // GMX
          arbitrumConfigurator.address, // ARB
          arbitrumCometAdmin.address,
          // WETH Comet
          arbitrumConfigurator.address, // tETH
          arbitrumConfigurator.address, // rETH
          arbitrumConfigurator.address, // weETH
          arbitrumConfigurator.address, // ezETH
          arbitrumCometAdmin.address,
        ],
        [
        // USDT Comet
          0, // tETH
          0, // tBTC
          0, // GMX
          0, // ARB
          0,
          // WETH Comet
          0, // tETH
          0, // rETH
          0, // weETH
          0, // ezETH
          0,
        ],
        [
        // USDT Comet
          'updateAssetSupplyCap(address,address,uint128)', // tETH
          'updateAssetSupplyCap(address,address,uint128)', // tBTC
          'updateAssetSupplyCap(address,address,uint128)', // GMX
          'updateAssetSupplyCap(address,address,uint128)', // ARB
          'deployAndUpgradeTo(address,address)',
          // WETH Comet
          'updateAssetSupplyCap(address,address,uint128)', // tETH
          'updateAssetSupplyCap(address,address,uint128)', // rETH
          'updateAssetSupplyCap(address,address,uint128)', // weETH
          'updateAssetSupplyCap(address,address,uint128)', // ezETH
          'deployAndUpgradeTo(address,address)',
        ],
        [
        // USDT Comet
          arbitrumUsdtUpdateTETHSupplyCapCalldata,
          arbitrumUsdtUpdateTBTCSupplyCapCalldata,
          arbitrumUsdtUpdateGMXSupplyCapCalldata,
          arbitrumUsdtUpdateARBSupplyCapCalldata,
          arbitrumUsdtDeployAndUpgradeToCalldata,
          // WETH Comet
          arbitrumWethUpdateTETHSupplyCapCalldata,
          arbitrumWethUpdateRETHSupplyCapCalldata,
          arbitrumWethUpdateWeETHSupplyCapCalldata,
          arbitrumWethUpdateEzETHSupplyCapCalldata,
          arbitrumWethDeployAndUpgradeToCalldata,
        ]
      ]
    );

    const createRetryableTicketGasParams2 = await estimateL2Transaction(
      {
        from: applyL1ToL2Alias(timelock.address),
        to: arbitrumBridgeReceiver.address,
        data: arbitrumProposalData2
      },
      arbitrumDm
    );

    const mainnetActions = [
      // 1. Arbitrum proposal USDC + USDC.e
      {
        contract: arbitrumInbox,
        signature: 'createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
        args: [
          arbitrumBridgeReceiver.address,                   // address to,
          0,                                                // uint256 l2CallValue,
          createRetryableTicketGasParams1.maxSubmissionCost, // uint256 maxSubmissionCost,
          arbitrumTimelock.address,                         // address excessFeeRefundAddress,
          arbitrumTimelock.address,                         // address callValueRefundAddress,
          createRetryableTicketGasParams1.gasLimit,          // uint256 gasLimit,
          createRetryableTicketGasParams1.maxFeePerGas*2,    // uint256 maxFeePerGas,
          arbitrumProposalData1,                             // bytes calldata data
        ],
        value: createRetryableTicketGasParams1.deposit.mul(2),
      },
      // 2. Arbitrum proposal USDT + WETH
      {
        contract: arbitrumInbox,
        signature: 'createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
        args: [
          arbitrumBridgeReceiver.address,                   // address to,
          0,                                                // uint256 l2CallValue,
          createRetryableTicketGasParams2.maxSubmissionCost, // uint256 maxSubmissionCost,
          arbitrumTimelock.address,                         // address excessFeeRefundAddress,
          arbitrumTimelock.address,                         // address callValueRefundAddress,
          createRetryableTicketGasParams2.gasLimit,          // uint256 gasLimit,
          createRetryableTicketGasParams2.maxFeePerGas*2,    // uint256 maxFeePerGas,
          arbitrumProposalData2,                             // bytes calldata data
        ],
        value: createRetryableTicketGasParams2.deposit.mul(2),
      },
    ];

    const description = `DESCRIPTION`;

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
    return true;
  },

  async verify(deploymentManager: DeploymentManager, govDeploymentManager) {
    // Arbitrum
    const {
      tETH: arbitrumTETH,
      tBTC: arbitrumTBTC,
      ezETH: arbitrumEZETH,
      GMX: arbitrumGMX,
      ARB: arbitrumARB,
    } = await deploymentManager.getContracts();

    // USDC Comet
    const arbitrumUsdcComet = new Contract(
      cometConfig.Arbitrum.USDC.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await deploymentManager.getSigner()
    );

    const tETHAssetInfoUsdc = await arbitrumUsdcComet.getAssetInfoByAddress(arbitrumTETH.address);
    const tBTCAssetInfoUsdc = await arbitrumUsdcComet.getAssetInfoByAddress(arbitrumTBTC.address);
    const ezETHAssetInfoUsdc = await arbitrumUsdcComet.getAssetInfoByAddress(arbitrumEZETH.address);
    const GMXAssetInfoUsdc = await arbitrumUsdcComet.getAssetInfoByAddress(arbitrumGMX.address);
    const ARBAssetInfoUsdc = await arbitrumUsdcComet.getAssetInfoByAddress(arbitrumARB.address);

    expect(tETHAssetInfoUsdc.scale).to.equal(exp(1, supplyCapConfig.Arbitrum.USDC.tETH.decimals));
    expect(tBTCAssetInfoUsdc.scale).to.equal(exp(1, supplyCapConfig.Arbitrum.USDC.tBTC.decimals));
    expect(ezETHAssetInfoUsdc.scale).to.equal(exp(1, supplyCapConfig.Arbitrum.USDC.ezETH.decimals));
    expect(GMXAssetInfoUsdc.scale).to.equal(exp(1, supplyCapConfig.Arbitrum.USDC.GMX.decimals));
    expect(ARBAssetInfoUsdc.scale).to.equal(exp(1, supplyCapConfig.Arbitrum.USDC.ARB.decimals));

    expect(tETHAssetInfoUsdc.supplyCap).to.equal(exp(supplyCapConfig.Arbitrum.USDC.tETH.newCap, supplyCapConfig.Arbitrum.USDC.tETH.decimals));
    expect(tBTCAssetInfoUsdc.supplyCap).to.equal(exp(supplyCapConfig.Arbitrum.USDC.tBTC.newCap, supplyCapConfig.Arbitrum.USDC.tBTC.decimals));
    expect(ezETHAssetInfoUsdc.supplyCap).to.equal(exp(supplyCapConfig.Arbitrum.USDC.ezETH.newCap, supplyCapConfig.Arbitrum.USDC.ezETH.decimals));
    expect(GMXAssetInfoUsdc.supplyCap).to.equal(exp(supplyCapConfig.Arbitrum.USDC.GMX.newCap, supplyCapConfig.Arbitrum.USDC.GMX.decimals));
    expect(ARBAssetInfoUsdc.supplyCap).to.equal(exp(supplyCapConfig.Arbitrum.USDC.ARB.newCap, supplyCapConfig.Arbitrum.USDC.ARB.decimals));

    // USDC.e Comet
    const arbitrumUsdceComet = new Contract(
      cometConfig.Arbitrum.USDCe.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await deploymentManager.getSigner()
    );

    const GMXAssetInfoUsdce = await arbitrumUsdceComet.getAssetInfoByAddress(arbitrumGMX.address);
    const ARBAssetInfoUsdce = await arbitrumUsdceComet.getAssetInfoByAddress(arbitrumARB.address);

    expect(GMXAssetInfoUsdce.scale).to.equal(exp(1, supplyCapConfig.Arbitrum.USDCe.GMX.decimals));
    expect(ARBAssetInfoUsdce.scale).to.equal(exp(1, supplyCapConfig.Arbitrum.USDCe.ARB.decimals));

    expect(GMXAssetInfoUsdce.supplyCap).to.equal(exp(supplyCapConfig.Arbitrum.USDCe.GMX.newCap, supplyCapConfig.Arbitrum.USDCe.GMX.decimals));
    expect(ARBAssetInfoUsdce.supplyCap).to.equal(exp(supplyCapConfig.Arbitrum.USDCe.ARB.newCap, supplyCapConfig.Arbitrum.USDCe.ARB.decimals));

    const arbitrumUsdtComet = new Contract(
      cometConfig.Arbitrum.USDT.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await deploymentManager.getSigner()
    );

    const tETHAssetInfoUsdt = await arbitrumUsdtComet.getAssetInfoByAddress(arbitrumTETH.address);
    const tBTCAssetInfoUsdt = await arbitrumUsdtComet.getAssetInfoByAddress(arbitrumTBTC.address);
    const GMXAssetInfoUsdt = await arbitrumUsdtComet.getAssetInfoByAddress(arbitrumGMX.address);
    const ARBAssetInfoUsdt = await arbitrumUsdtComet.getAssetInfoByAddress(arbitrumARB.address);

    expect(tETHAssetInfoUsdt.scale).to.equal(exp(1, supplyCapConfig.Arbitrum.USDT.tETH.decimals));
    expect(tBTCAssetInfoUsdt.scale).to.equal(exp(1, supplyCapConfig.Arbitrum.USDT.tBTC.decimals));
    expect(GMXAssetInfoUsdt.scale).to.equal(exp(1, supplyCapConfig.Arbitrum.USDT.GMX.decimals));
    expect(ARBAssetInfoUsdt.scale).to.equal(exp(1, supplyCapConfig.Arbitrum.USDT.ARB.decimals));
    expect(tETHAssetInfoUsdt.supplyCap).to.equal(exp(supplyCapConfig.Arbitrum.USDT.tETH.newCap, supplyCapConfig.Arbitrum.USDT.tETH.decimals));
    expect(tBTCAssetInfoUsdt.supplyCap).to.equal(exp(supplyCapConfig.Arbitrum.USDT.tBTC.newCap, supplyCapConfig.Arbitrum.USDT.tBTC.decimals));
    expect(GMXAssetInfoUsdt.supplyCap).to.equal(exp(supplyCapConfig.Arbitrum.USDT.GMX.newCap, supplyCapConfig.Arbitrum.USDT.GMX.decimals));
    expect(ARBAssetInfoUsdt.supplyCap).to.equal(exp(supplyCapConfig.Arbitrum.USDT.ARB.newCap, supplyCapConfig.Arbitrum.USDT.ARB.decimals));

    const arbitrumDmWeth = govDeploymentManager.bridgedDeploymentManagers.get('arbitrum:weth') as DeploymentManager;
    const {
      rETH: arbitrumRETH,
      weETH: arbitrumWeETH,
      ezETH: arbitrumEzETH,
    } = await arbitrumDmWeth.getContracts();
    const arbitrumWethComet = new Contract(
      cometConfig.Arbitrum.WETH.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await arbitrumDmWeth.getSigner()
    );

    const tETHAssetInfoWeth = await arbitrumWethComet.getAssetInfoByAddress(arbitrumTETH.address);
    const rETHAssetInfoWeth = await arbitrumWethComet.getAssetInfoByAddress(arbitrumRETH.address);
    const weETHAssetInfoWeth = await arbitrumWethComet.getAssetInfoByAddress(arbitrumWeETH.address);
    const ezETHAssetInfoWeth = await arbitrumWethComet.getAssetInfoByAddress(arbitrumEzETH.address);

    expect(tETHAssetInfoWeth.scale).to.equal(exp(1, supplyCapConfig.Arbitrum.WETH.tETH.decimals));
    expect(rETHAssetInfoWeth.scale).to.equal(exp(1, supplyCapConfig.Arbitrum.WETH.rETH.decimals));
    expect(weETHAssetInfoWeth.scale).to.equal(exp(1, supplyCapConfig.Arbitrum.WETH.weETH.decimals));
    expect(ezETHAssetInfoWeth.scale).to.equal(exp(1, supplyCapConfig.Arbitrum.WETH.ezETH.decimals));

    expect(tETHAssetInfoWeth.supplyCap).to.equal(exp(supplyCapConfig.Arbitrum.WETH.tETH.newCap, supplyCapConfig.Arbitrum.WETH.tETH.decimals));
    expect(rETHAssetInfoWeth.supplyCap).to.equal(exp(supplyCapConfig.Arbitrum.WETH.rETH.newCap, supplyCapConfig.Arbitrum.WETH.rETH.decimals));
    expect(weETHAssetInfoWeth.supplyCap).to.equal(exp(supplyCapConfig.Arbitrum.WETH.weETH.newCap, supplyCapConfig.Arbitrum.WETH.weETH.decimals));
    expect(ezETHAssetInfoWeth.supplyCap).to.equal(exp(supplyCapConfig.Arbitrum.WETH.ezETH.newCap, supplyCapConfig.Arbitrum.WETH.ezETH.decimals));
  },
});
