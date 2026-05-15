import { expect } from 'chai';
import { Contract, utils } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

/*
// Base

Base USDC Comet
Symbol	Current Cap	Supply Balance	Utilization	Proposed Cap	Rule
tBTC	75	15	20.06%	20	Rule 2 (~33% buffer)

Base WETH Comet
Symbol	Current Cap	Supply Balance	Utilization	Proposed Cap	Rule
wsuperOETHb	2,000	676	33.81%	811	Rule 2 (~20% buffer)
weETH	7,500	363	4.84%	472	Rule 2 (~30% buffer)
ezETH	1,000	182	18.23%	237	Rule 2 (~30% buffer)

*/

const cometConfig = {
  Base: {
    USDC: {
      address: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
    },
    WETH: {
      address: '0x46e6b214b524310239732D51387075E0e70970bf',
    },
  },
};

const supplyCapConfig = {
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
};


export default migration('1778758319_update_supply_caps_on_l2', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) {

    const trace = deploymentManager.tracer();

    const {
      governor,
      baseL1CrossDomainMessenger,
    } = await govDeploymentManager.getContracts();

    // Base
    const {
      bridgeReceiver : baseBridgeReceiver,
      configurator: baseConfigurator,
      cometAdmin: baseCometAdmin,
      tBTC: baseTBTC,
    } = await deploymentManager.getContracts();

    const baseUsdcUpdateTBTCSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Base.USDC.address, baseTBTC.address, exp(supplyCapConfig.Base.USDC.tBTC.newCap, supplyCapConfig.Base.USDC.tBTC.decimals)]);
    const baseUsdcDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [baseConfigurator.address, cometConfig.Base.USDC.address]);

    const baseDmWeth = await govDeploymentManager.addBridgedDeploymentManager('base', 'weth', deploymentManager.hre);
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

    const mainnetActions = [
      // 1. Base proposal
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [baseBridgeReceiver.address, baseProposalData, 3_000_000]
      },
    ];

    const description = `DESCRIPTION`;

    const txn = await govDeploymentManager.retry(async () =>
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

  async verify(deploymentManager: DeploymentManager, govDeploymentManager) {    
    // Base
    const {
      tBTC: baseTBTC,
    } = await deploymentManager.getContracts();

    const baseUsdcComet = new Contract(
      cometConfig.Base.USDC.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await deploymentManager.getSigner()
    );

    const tBTCAssetInfoBaseUsdc = await baseUsdcComet.getAssetInfoByAddress(baseTBTC.address);

    expect(tBTCAssetInfoBaseUsdc.scale).to.equal(exp(1, supplyCapConfig.Base.USDC.tBTC.decimals));
    expect(tBTCAssetInfoBaseUsdc.supplyCap).to.equal(exp(supplyCapConfig.Base.USDC.tBTC.newCap, supplyCapConfig.Base.USDC.tBTC.decimals));

    const baseDmWeth = govDeploymentManager.bridgedDeploymentManagers.get('base:weth') as DeploymentManager;
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
  },
});
