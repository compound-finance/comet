import { expect } from 'chai';
import { Contract, utils } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

/*
// Polygon

Polygon USDC Comet
Symbol	Current Cap	Supply Balance	Utilization	Proposed Cap	Rule
WPOL	8,000,000	377,485	4.72%	490,731	Rule 2 (~30% buffer)
MaticX	3,200,000	183,489	5.73%	238,536	Rule 2 (~30% buffer)

Polygon USDT Comet
Symbol	Current Cap	Supply Balance	Utilization	Proposed Cap	Rule
WPOL	5,000,000	155,574	3.11%	202,246	Rule 2 (~30% buffer)
MaticX	4,160,000	123,953	2.98%	161,140	Rule 2 (~30% buffer)

*/

const cometConfig = {
  Polygon: {
    USDC: {
      address: '0xF25212E676D1F7F89Cd72fFEe66158f541246445',
    },
    USDT: {
      address: '0xaeB318360f27748Acb200CE616E389A6C9409a07',
    },
  },
};

const supplyCapConfig = {
  Polygon: {
    USDC: {
      WPOL: {
        newCap: 490_731,
        decimals: 18,
      },
      MaticX: {
        newCap: 238_536,
        decimals: 18,
      },
    },
    USDT: {
      WPOL: {
        newCap: 202_246,
        decimals: 18,
      },
      MaticX: {
        newCap: 161_140,
        decimals: 18,
      },
    },
  },
};


export default migration('1779114960_update_supply_caps_on_l2', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager, governanceDeploymentManager: DeploymentManager) {

    const trace = deploymentManager.tracer();

    const {
      governor,
      fxRoot,
    } = await governanceDeploymentManager.getContracts();

    // Polygon
    const {
      bridgeReceiver: polygonBridgeReceiver,
      configurator: polygonConfigurator,
      cometAdmin: polygonCometAdmin,
      WPOL: polygonWPOL,
      MaticX: polygonMaticX,
    } = await deploymentManager.getContracts();

    const polygonUsdcUpdateWPOLSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Polygon.USDC.address, polygonWPOL.address, exp(supplyCapConfig.Polygon.USDC.WPOL.newCap, supplyCapConfig.Polygon.USDC.WPOL.decimals)]);
    const polygonUsdcUpdateMaticXSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Polygon.USDC.address, polygonMaticX.address, exp(supplyCapConfig.Polygon.USDC.MaticX.newCap, supplyCapConfig.Polygon.USDC.MaticX.decimals)]);
    const polygonUsdcDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [polygonConfigurator.address, cometConfig.Polygon.USDC.address]);

    const polygonUsdtUpdateWPOLSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Polygon.USDT.address, polygonWPOL.address, exp(supplyCapConfig.Polygon.USDT.WPOL.newCap, supplyCapConfig.Polygon.USDT.WPOL.decimals)]);
    const polygonUsdtUpdateMaticXSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Polygon.USDT.address, polygonMaticX.address, exp(supplyCapConfig.Polygon.USDT.MaticX.newCap, supplyCapConfig.Polygon.USDT.MaticX.decimals)]);
    const polygonUsdtDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [polygonConfigurator.address, cometConfig.Polygon.USDT.address]);

    const polygonProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          // USDC Comet
          polygonConfigurator.address,
          polygonConfigurator.address,
          polygonCometAdmin.address,
          // USDT Comet
          polygonConfigurator.address,
          polygonConfigurator.address,
          polygonCometAdmin.address,
        ],
        [
          // USDC Comet
          0,
          0,
          0,
          // USDT Comet
          0,
          0,
          0,
        ],
        [
          // USDC Comet
          'updateAssetSupplyCap(address,address,uint128)',
          'updateAssetSupplyCap(address,address,uint128)',
          'deployAndUpgradeTo(address,address)',
          // USDT Comet
          'updateAssetSupplyCap(address,address,uint128)',
          'updateAssetSupplyCap(address,address,uint128)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          // USDC Comet
          polygonUsdcUpdateWPOLSupplyCapCalldata,
          polygonUsdcUpdateMaticXSupplyCapCalldata,
          polygonUsdcDeployAndUpgradeToCalldata,
          // USDT Comet
          polygonUsdtUpdateWPOLSupplyCapCalldata,
          polygonUsdtUpdateMaticXSupplyCapCalldata,
          polygonUsdtDeployAndUpgradeToCalldata
        ],
      ]
    );

    const mainnetActions = [
      // 1. Polygon proposal
      {
        contract: fxRoot,
        signature: 'sendMessageToChild(address,bytes)',
        args: [polygonBridgeReceiver.address, polygonProposalData],
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
    // Polygon
    const {
      WPOL: polygonWPOL,
      MaticX: polygonMaticX,
    } = await deploymentManager.getContracts();

    // USDC Comet
    const polygonUsdcComet = new Contract(
      cometConfig.Polygon.USDC.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await deploymentManager.getSigner()
    );

    const WPOLAssetInfoUsdc = await polygonUsdcComet.getAssetInfoByAddress(polygonWPOL.address);
    const MaticXAssetInfoUsdc = await polygonUsdcComet.getAssetInfoByAddress(polygonMaticX.address);

    expect(WPOLAssetInfoUsdc.scale).to.equal(exp(1, supplyCapConfig.Polygon.USDC.WPOL.decimals));
    expect(WPOLAssetInfoUsdc.supplyCap).to.equal(exp(supplyCapConfig.Polygon.USDC.WPOL.newCap, supplyCapConfig.Polygon.USDC.WPOL.decimals));

    expect(MaticXAssetInfoUsdc.scale).to.equal(exp(1, supplyCapConfig.Polygon.USDC.MaticX.decimals));
    expect(MaticXAssetInfoUsdc.supplyCap).to.equal(exp(supplyCapConfig.Polygon.USDC.MaticX.newCap, supplyCapConfig.Polygon.USDC.MaticX.decimals));

    // USDT Comet
    const polygonUsdtComet = new Contract(
      cometConfig.Polygon.USDT.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await deploymentManager.getSigner()
    );

    const WPOLAssetInfoUsdt = await polygonUsdtComet.getAssetInfoByAddress(polygonWPOL.address);
    const MaticXAssetInfoUsdt = await polygonUsdtComet.getAssetInfoByAddress(polygonMaticX.address);

    expect(WPOLAssetInfoUsdt.scale).to.equal(exp(1, supplyCapConfig.Polygon.USDT.WPOL.decimals));
    expect(WPOLAssetInfoUsdt.supplyCap).to.equal(exp(supplyCapConfig.Polygon.USDT.WPOL.newCap, supplyCapConfig.Polygon.USDT.WPOL.decimals));

    expect(MaticXAssetInfoUsdt.scale).to.equal(exp(1, supplyCapConfig.Polygon.USDT.MaticX.decimals));
    expect(MaticXAssetInfoUsdt.supplyCap).to.equal(exp(supplyCapConfig.Polygon.USDT.MaticX.newCap, supplyCapConfig.Polygon.USDT.MaticX.decimals));
  },
});
