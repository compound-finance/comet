import { expect } from 'chai';
import { Contract, utils } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

/*
// Unichain

Unichain USDC Comet
Symbol	Current Cap	Supply Balance	Utilization	Proposed Cap	Rule
UNI	100,000	3,313	3.31%	4,307	Rule 2 (~30% buffer)

Unichain WETH Comet
Symbol	Current Cap	Supply Balance	Utilization	Proposed Cap	Rule
ezETH	2,200	0	0.00%	0	Rule 1
UNI	500,000	20	0.00%	0	Rule 1
weETH	5,000	733	14.65%	952	Rule 2 (~30% buffer)
*/

const cometConfig = {
  Unichain: {
    USDC: {
      address: '0x2c7118c4C88B9841FCF839074c26Ae8f035f2921',
    },
    WETH: {
      address: '0x6C987dDE50dB1dcDd32Cd4175778C2a291978E2a',
    },
  },
};

const supplyCapConfig = {
  Unichain: {
    USDC: {
      UNI: {
        newCap: 4_307,
        decimals: 18,
      },
    },
    WETH: {
      ezETH: {
        newCap: 0,
        decimals: 18,
      },
      UNI: {
        newCap: 0,
        decimals: 18,
      },
      weETH: {
        newCap: 952,
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
      unichainL1CrossDomainMessenger,
    } = await governanceDeploymentManager.getContracts();

    // Unichain
    const unichainDm = await governanceDeploymentManager.addBridgedDeploymentManager('unichain', 'weth', deploymentManager.hre);
    const {
      bridgeReceiver: unichainBridgeReceiver,
      configurator: unichainConfigurator,
      cometAdmin: unichainCometAdmin,
      UNI: unichainMETH,
      ezETH: unichainEzETH,
      weETH: unichainWeETH,
    } = await unichainDm.getContracts();

    const unichainUsdcUniUpdateSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Unichain.USDC.address, unichainMETH.address, exp(supplyCapConfig.Unichain.USDC.UNI.newCap, supplyCapConfig.Unichain.USDC.UNI.decimals)]);
    const unichainUsdcDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [unichainConfigurator.address, cometConfig.Unichain.USDC.address]);

    const unichainWethUniETHUpdateSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Unichain.WETH.address, unichainEzETH.address, exp(supplyCapConfig.Unichain.WETH.UNI.newCap, supplyCapConfig.Unichain.WETH.UNI.decimals)]);
    const unichainWethEzEthUpdateSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Unichain.WETH.address, unichainMETH.address, exp(supplyCapConfig.Unichain.WETH.ezETH.newCap, supplyCapConfig.Unichain.WETH.ezETH.decimals)]);
    const unichainWethWeEthUpdateSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Unichain.WETH.address, unichainWeETH.address, exp(supplyCapConfig.Unichain.WETH.weETH.newCap, supplyCapConfig.Unichain.WETH.weETH.decimals)]);
    const unichainWethDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [unichainConfigurator.address, cometConfig.Unichain.WETH.address]);

    const unichainProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          // USDC Comet
          unichainConfigurator.address, // UNI
          unichainCometAdmin.address,
          // WETH Comet
          unichainConfigurator.address, // UNI
          unichainConfigurator.address, // ezETH
          unichainConfigurator.address, // weETH
          unichainCometAdmin.address,
        ],
        [
          // USDC Comet
          0, // UNI
          0,
          // WETH Comet
          0, // UNI
          0, // ezETH
          0, // weETH
          0,
        ],
        [
          // USDC Comet
          'updateAssetSupplyCap(address,address,uint128)', // UNI
          'deployAndUpgradeTo(address,address)',
          // WETH Comet
          'updateAssetSupplyCap(address,address,uint128)', // UNI
          'updateAssetSupplyCap(address,address,uint128)', // ezETH
          'updateAssetSupplyCap(address,address,uint128)', // weETH
          'deployAndUpgradeTo(address,address)',
        ],
        [
          // USDC Comet
          unichainUsdcUniUpdateSupplyCapCalldata,
          unichainUsdcDeployAndUpgradeToCalldata,
          // WETH Comet
          unichainWethUniETHUpdateSupplyCapCalldata,
          unichainWethEzEthUpdateSupplyCapCalldata,
          unichainWethWeEthUpdateSupplyCapCalldata,
          unichainWethDeployAndUpgradeToCalldata,
        ],
      ]
    );

    const mainnetActions = [
      // 1. Unichain proposal
      {
        contract: unichainL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [unichainBridgeReceiver.address, unichainProposalData, 3_000_000],
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

  async verify(deploymentManager: DeploymentManager, governanceDeploymentManager: DeploymentManager) {
    // Unichain
    const unichainDm = governanceDeploymentManager.bridgedDeploymentManagers.get('unichain:weth') as DeploymentManager;
    const {
      UNI: unichainUNI,
      ezETH: unichainEzETH,
      weETH: unichainWeETH,
    } = await unichainDm.getContracts();

    // USDC Comet
    const unichainUsdcComet = new Contract(
      cometConfig.Unichain.USDC.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await deploymentManager.getSigner()
    );

    const unichainUNIAssetInfoUsdc = await unichainUsdcComet.getAssetInfoByAddress(unichainUNI.address);

    expect(unichainUNIAssetInfoUsdc.scale).to.equal(exp(1, supplyCapConfig.Unichain.USDC.UNI.decimals));
    expect(unichainUNIAssetInfoUsdc.supplyCap).to.equal(exp(supplyCapConfig.Unichain.USDC.UNI.newCap, supplyCapConfig.Unichain.USDC.UNI.decimals));

    // WETH Comet
    const unichainWethComet = new Contract(
      cometConfig.Unichain.WETH.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await deploymentManager.getSigner()
    );

    const unichainUniAssetInfoWeth = await unichainWethComet.getAssetInfoByAddress(unichainUNI.address);
    const unichainEzETHAssetInfoWeth = await unichainWethComet.getAssetInfoByAddress(unichainEzETH.address);
    const unichainWeETHAssetInfoWeth = await unichainWethComet.getAssetInfoByAddress(unichainWeETH.address);

    expect(unichainUniAssetInfoWeth.scale).to.equal(exp(1, supplyCapConfig.Unichain.WETH.UNI.decimals));
    expect(unichainEzETHAssetInfoWeth.scale).to.equal(exp(1, supplyCapConfig.Unichain.WETH.ezETH.decimals));
    expect(unichainWeETHAssetInfoWeth.scale).to.equal(exp(1, supplyCapConfig.Unichain.WETH.weETH.decimals));

    expect(unichainUniAssetInfoWeth.supplyCap).to.equal(exp(supplyCapConfig.Unichain.WETH.UNI.newCap, supplyCapConfig.Unichain.WETH.UNI.decimals));
    expect(unichainEzETHAssetInfoWeth.supplyCap).to.equal(exp(supplyCapConfig.Unichain.WETH.ezETH.newCap, supplyCapConfig.Unichain.WETH.ezETH.decimals));
    expect(unichainWeETHAssetInfoWeth.supplyCap).to.equal(exp(supplyCapConfig.Unichain.WETH.weETH.newCap, supplyCapConfig.Unichain.WETH.weETH.decimals));
  },
});
