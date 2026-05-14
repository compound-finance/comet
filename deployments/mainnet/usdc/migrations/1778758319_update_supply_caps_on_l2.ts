import { expect } from 'chai';
import { Contract, utils } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { forkedHreForBase } from '../../../../plugins/scenario/utils/hreForBase';
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

// Base

Base USDC Comet
Symbol	Current Cap	Supply Balance	Utilization	Proposed Cap	Rule
tBTC	75	15	20.06%	20	Rule 2 (~33% buffer)

Base WETH Comet
Symbol	Current Cap	Supply Balance	Utilization	Proposed Cap	Rule
wsuperOETHb	2,000	676	33.81%	811	Rule 2 (~20% buffer)
weETH	7,500	363	4.84%	472	Rule 2 (~30% buffer)
ezETH	1,000	182	18.23%	237	Rule 2 (~30% buffer)

// Linea

Linea WETH Comet
Symbol	Current Cap	Supply Balance	Utilization	Proposed Cap	Rule
ezETH	4,830	8	0.16%	0	Rule 1
weETH	3,550	93	2.63%	121	Rule 2 (~30% buffer)

// Mantle

Mantle USDe Comet
Symbol	Current Cap	Supply Balance	Utilization	Proposed Cap	Rule
mETH	3,000	1,533	51.09%	1,993	Rule 2 (~30% buffer)
FBTC	120	4	3.42%	5	Rule 2 (~25% buffer)
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
  Base: {
    USDC: {
      address: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
    },
    WETH: {
      address: '0x46e6b214b524310239732D51387075E0e70970bf',
    },
  },
  Linea: {
    WETH: {
      address: '0x60F2058379716A64a7A5d29219397e79bC552194',
    },
  },
  Mantle: {
    USDe: {
      address: '0x606174f62cd968d8e684c645080fa694c1D7786E',
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
  Base: {
    USDC: {
      tBTC: {
        newCap: 20,
        decimals: 18,
      },
    },
    WETH: {
      wsuperOETHb: {
        newCap: 811,
        decimals: 18,
      },
      weETH: {
        newCap: 472,
        decimals: 18,
      },
      ezETH: {
        newCap: 237,
        decimals: 18,
      },
    },
  },
  Linea: {
    WETH: {
      ezETH: {
        newCap: 0,
        decimals: 18,
      },
      weETH: {
        newCap: 121,
        decimals: 18,
      },
    },
  },
  Mantle: {
    USDe: {
      mETH: {
        newCap: 1_993,
        decimals: 18,
      },
      FBTC: {
        newCap: 5,
        decimals: 8,
      },
    },
  },
};


export default migration('1778758319_update_supply_caps_on_l2', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {

    const trace = deploymentManager.tracer();

    const {
      timelock,
      governor,
      baseL1CrossDomainMessenger,
      arbitrumInbox,
      lineaMessageService,
      mantleL1CrossDomainMessenger
    } = await deploymentManager.getContracts();

    // Arbitrum
    const arbitrumHre = await forkedHreForBase({ name: 'arbitrum-usdc', network: 'arbitrum', deployment: 'usdc' });
    const arbitrumDm = await deploymentManager.addBridgedDeploymentManager('arbitrum', 'usdc', arbitrumHre);
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

    const arbitrumDmWeth = await deploymentManager.addBridgedDeploymentManager('arbitrum', 'weth', arbitrumHre);
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

    // Base
    const baseHre = await forkedHreForBase({ name: 'base-usdc', network: 'base', deployment: 'usdc' });
    const baseDmUsdc = await deploymentManager.addBridgedDeploymentManager('base', 'usdc', baseHre);
    const {
      bridgeReceiver : baseBridgeReceiver,
      configurator: baseConfigurator,
      cometAdmin: baseCometAdmin,
      tBTC: baseTBTC,
    } = await baseDmUsdc.getContracts();

    const baseUsdcUpdateTBTCSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Base.USDC.address, baseTBTC.address, exp(supplyCapConfig.Base.USDC.tBTC.newCap, supplyCapConfig.Base.USDC.tBTC.decimals)]);
    const baseUsdcDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [baseConfigurator.address, cometConfig.Base.USDC.address]);

    const baseDmWeth = await deploymentManager.addBridgedDeploymentManager('base', 'weth', baseHre);
    const {
      wsuperOETHb: baseSuperOETHb,
      weETH: baseWeETH,
      ezETH: baseEzETH,
    } = await baseDmWeth.getContracts();

    const baseWethUpdateSuperOETHbSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Base.WETH.address, baseSuperOETHb.address, exp(supplyCapConfig.Base.WETH.wsuperOETHb.newCap, supplyCapConfig.Base.WETH.wsuperOETHb.decimals)]);
    const baseWethUpdateWeETHSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Base.WETH.address, baseWeETH.address, exp(supplyCapConfig.Base.WETH.weETH.newCap, supplyCapConfig.Base.WETH.weETH.decimals)]);
    const baseWethUpdateEzETHSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Base.WETH.address, baseEzETH.address, exp(supplyCapConfig.Base.WETH.ezETH.newCap, supplyCapConfig.Base.WETH.ezETH.decimals)]);
    const baseWethDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [baseConfigurator.address, cometConfig.Base.WETH.address]);

    const baseProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          // USDC Comet
          baseConfigurator.address, // tBTC
          baseCometAdmin.address,
          // WETH Comet
          baseConfigurator.address, // wsuperOETHb
          baseConfigurator.address, // weETH
          baseConfigurator.address, // ezETH
          baseCometAdmin.address,
        ],
        [
          // USDC Comet
          0, // tBTC
          0,
          // WETH Comet
          0, // wsuperOETHb
          0, // weETH
          0, // ezETH
          0,
        ],
        [
          // USDC Comet
          'updateAssetSupplyCap(address,address,uint128)', // tBTC
          'deployAndUpgradeTo(address,address)',
          // WETH Comet
          'updateAssetSupplyCap(address,address,uint128)', // wsuperOETHb
          'updateAssetSupplyCap(address,address,uint128)', // weETH
          'updateAssetSupplyCap(address,address,uint128)', // ezETH
          'deployAndUpgradeTo(address,address)',
        ],
        [
          // USDC Comet
          baseUsdcUpdateTBTCSupplyCapCalldata,
          baseUsdcDeployAndUpgradeToCalldata,
          // WETH Comet
          baseWethUpdateSuperOETHbSupplyCapCalldata,
          baseWethUpdateWeETHSupplyCapCalldata,
          baseWethUpdateEzETHSupplyCapCalldata,
          baseWethDeployAndUpgradeToCalldata,
        ],
      ]
    );


    // Linea
    const lineaHre = await forkedHreForBase({ name: 'linea-weth', network: 'linea', deployment: 'weth' });
    const lineaDm = await deploymentManager.addBridgedDeploymentManager('linea', 'weth', lineaHre);
    const {
      bridgeReceiver: lineaBridgeReceiver,
      configurator: lineaConfigurator,
      cometAdmin: lineaCometAdmin,
      ezETH: lineaEzETH,
      weETH: lineaWeETH,
    } = await lineaDm.getContracts();

    const lineaWethUpdateEZETHSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Linea.WETH.address, lineaEzETH.address, exp(supplyCapConfig.Linea.WETH.ezETH.newCap, supplyCapConfig.Linea.WETH.ezETH.decimals)]);
    const lineaWethUpdateWeETHSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Linea.WETH.address, lineaWeETH.address, exp(supplyCapConfig.Linea.WETH.weETH.newCap, supplyCapConfig.Linea.WETH.weETH.decimals)]);
    const lineaDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [lineaConfigurator.address, cometConfig.Linea.WETH.address]);

    const lineaProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          // WETH Comet
          lineaConfigurator.address,
          lineaConfigurator.address,
          lineaCometAdmin.address,
        ],
        [
          // WETH Comet
          0,
          0,
          0
        ],
        [
          // WETH Comet
          'updateAssetSupplyCap(address,address,uint128)',
          'updateAssetSupplyCap(address,address,uint128)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          // WETH Comet
          lineaWethUpdateEZETHSupplyCapCalldata,
          lineaWethUpdateWeETHSupplyCapCalldata,
          lineaDeployAndUpgradeToCalldata
        ],
      ]
    );

    // Mantle
    const mantleHre = await forkedHreForBase({ name: 'mantle-usde', network: 'mantle', deployment: 'usde' });
    const mantleDm = await deploymentManager.addBridgedDeploymentManager('mantle', 'usde', mantleHre);
    const {
      bridgeReceiver: mantleBridgeReceiver,
      configurator: mantleConfigurator,
      cometAdmin: mantleCometAdmin,
      mETH: mantleMETH,
      FBTC: mantleFBTC,
    } = await mantleDm.getContracts();

    const mantleMETHUpdateSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Mantle.USDe.address, mantleMETH.address, exp(supplyCapConfig.Mantle.USDe.mETH.newCap, supplyCapConfig.Mantle.USDe.mETH.decimals)]);
    const mantleFBTCUpdateSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Mantle.USDe.address, mantleFBTC.address, exp(supplyCapConfig.Mantle.USDe.FBTC.newCap, supplyCapConfig.Mantle.USDe.FBTC.decimals)]);
    const mantleDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [mantleConfigurator.address, cometConfig.Mantle.USDe.address]);

    const mantleProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          // USDe Comet
          mantleConfigurator.address, // mETH
          mantleConfigurator.address, // FBTC
          mantleCometAdmin.address,
        ],
        [
          // USDe Comet
          0, // mETH
          0, // FBTC
          0,
        ],
        [
          // USDe Comet
          'updateAssetSupplyCap(address,address,uint128)', // mETH
          'updateAssetSupplyCap(address,address,uint128)', // FBTC
          'deployAndUpgradeTo(address,address)',
        ],
        [
          // USDe Comet
          mantleMETHUpdateSupplyCapCalldata,
          mantleFBTCUpdateSupplyCapCalldata,
          mantleDeployAndUpgradeToCalldata,
        ],
      ]
    );

    const mainnetActions = [
      // Arbitrum proposal USDC + USDC.e
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
      // Arbitrum proposal USDT + WETH
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
      // Base proposal
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [baseBridgeReceiver.address, baseProposalData, 3_000_000]
      },
      // Linea proposal
      {
        contract: lineaMessageService,
        signature: 'sendMessage(address,uint256,bytes)',
        args: [lineaBridgeReceiver.address, 0, lineaProposalData],
      },
      // Mantle proposal
      {
        contract: mantleL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [mantleBridgeReceiver.address, mantleProposalData, 2_500_000],
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
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    // Arbitrum
    const arbitrumDm = deploymentManager.bridgedDeploymentManagers.get('arbitrum:usdc') as DeploymentManager;
    
    const {
      tETH: arbitrumTETH,
      tBTC: arbitrumTBTC,
      ezETH: arbitrumEZETH,
      GMX: arbitrumGMX,
      ARB: arbitrumARB,
    } = await arbitrumDm.getContracts();

    // USDC Comet
    const arbitrumUsdcComet = new Contract(
      cometConfig.Arbitrum.USDC.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await arbitrumDm.getSigner()
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
      await arbitrumDm.getSigner()
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
      await arbitrumDm.getSigner()
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

    const arbitrumDmWeth = deploymentManager.bridgedDeploymentManagers.get('arbitrum:weth') as DeploymentManager;
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
    
    // Base
    const baseDmUsdc = deploymentManager.bridgedDeploymentManagers.get('base:usdc') as DeploymentManager;
    const {
      tBTC: baseTBTC,
    } = await baseDmUsdc.getContracts();

    const baseUsdcComet = new Contract(
      cometConfig.Base.USDC.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await baseDmUsdc.getSigner()
    );

    const tBTCAssetInfoBaseUsdc = await baseUsdcComet.getAssetInfoByAddress(baseTBTC.address);

    expect(tBTCAssetInfoBaseUsdc.scale).to.equal(exp(1, supplyCapConfig.Base.USDC.tBTC.decimals));
    expect(tBTCAssetInfoBaseUsdc.supplyCap).to.equal(exp(supplyCapConfig.Base.USDC.tBTC.newCap, supplyCapConfig.Base.USDC.tBTC.decimals));

    const baseDmWeth = deploymentManager.bridgedDeploymentManagers.get('base:weth') as DeploymentManager;
    const {
      wsuperOETHb: baseSuperOETHb,
      weETH: baseWeETH,
      ezETH: baseEzETH,
    } = await baseDmWeth.getContracts();

    const baseWethComet = new Contract(
      cometConfig.Base.WETH.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await baseDmWeth.getSigner()
    );

    const superOETHbAssetInfoBaseWeth = await baseWethComet.getAssetInfoByAddress(baseSuperOETHb.address);
    const weETHAssetInfoBaseWeth = await baseWethComet.getAssetInfoByAddress(baseWeETH.address);
    const ezETHAssetInfoBaseWeth = await baseWethComet.getAssetInfoByAddress(baseEzETH.address);

    expect(superOETHbAssetInfoBaseWeth.scale).to.equal(exp(1, supplyCapConfig.Base.WETH.wsuperOETHb.decimals));
    expect(weETHAssetInfoBaseWeth.scale).to.equal(exp(1, supplyCapConfig.Base.WETH.weETH.decimals));
    expect(ezETHAssetInfoBaseWeth.scale).to.equal(exp(1, supplyCapConfig.Base.WETH.ezETH.decimals));

    expect(superOETHbAssetInfoBaseWeth.supplyCap).to.equal(exp(supplyCapConfig.Base.WETH.wsuperOETHb.newCap, supplyCapConfig.Base.WETH.wsuperOETHb.decimals));
    expect(weETHAssetInfoBaseWeth.supplyCap).to.equal(exp(supplyCapConfig.Base.WETH.weETH.newCap, supplyCapConfig.Base.WETH.weETH.decimals));
    expect(ezETHAssetInfoBaseWeth.supplyCap).to.equal(exp(supplyCapConfig.Base.WETH.ezETH.newCap, supplyCapConfig.Base.WETH.ezETH.decimals));

    // Linea
    const lineaDm = deploymentManager.bridgedDeploymentManagers.get('linea:weth') as DeploymentManager;
    const {
      ezETH: lineaEzETH,
      weETH: lineaWeETH,
    } = await lineaDm.getContracts();
    
    const lineaWethComet = new Contract(
      cometConfig.Linea.WETH.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await lineaDm.getSigner()
    );

    const ezETHAssetInfoLineaWeth = await lineaWethComet.getAssetInfoByAddress(lineaEzETH.address);
    const weETHAssetInfoLineaWeth = await lineaWethComet.getAssetInfoByAddress(lineaWeETH.address);

    expect(ezETHAssetInfoLineaWeth.scale).to.equal(exp(1, supplyCapConfig.Linea.WETH.ezETH.decimals));
    expect(weETHAssetInfoLineaWeth.scale).to.equal(exp(1, supplyCapConfig.Linea.WETH.weETH.decimals));

    expect(ezETHAssetInfoLineaWeth.supplyCap).to.equal(exp(supplyCapConfig.Linea.WETH.ezETH.newCap, supplyCapConfig.Linea.WETH.ezETH.decimals));
    expect(weETHAssetInfoLineaWeth.supplyCap).to.equal(exp(supplyCapConfig.Linea.WETH.weETH.newCap, supplyCapConfig.Linea.WETH.weETH.decimals));

    // Mantle
    const mantleDm = deploymentManager.bridgedDeploymentManagers.get('mantle:usde') as DeploymentManager;
    const {
      mETH: mantleMETH,
      FBTC: mantleFBTC,
    } = await mantleDm.getContracts();

    const mantleUsdeComet = new Contract(
      cometConfig.Mantle.USDe.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await mantleDm.getSigner()
    );

    const mETHAssetInfoMantleUsde = await mantleUsdeComet.getAssetInfoByAddress(mantleMETH.address);
    const FBTCAssetInfoMantleUsde = await mantleUsdeComet.getAssetInfoByAddress(mantleFBTC.address);

    expect(mETHAssetInfoMantleUsde.scale).to.equal(exp(1, supplyCapConfig.Mantle.USDe.mETH.decimals));
    expect(FBTCAssetInfoMantleUsde.scale).to.equal(exp(1, supplyCapConfig.Mantle.USDe.FBTC.decimals));

    expect(mETHAssetInfoMantleUsde.supplyCap).to.equal(exp(supplyCapConfig.Mantle.USDe.mETH.newCap, supplyCapConfig.Mantle.USDe.mETH.decimals));
    expect(FBTCAssetInfoMantleUsde.supplyCap).to.equal(exp(supplyCapConfig.Mantle.USDe.FBTC.newCap, supplyCapConfig.Mantle.USDe.FBTC.decimals));
  },
});
