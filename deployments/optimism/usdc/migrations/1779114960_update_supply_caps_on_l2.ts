import { expect } from 'chai';
import { Contract, utils } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

/*
// Optimism

Optimism USDC Comet
Symbol	Current Cap	Supply Balance	Utilization	Proposed Cap	Rule
OP	1,400,000	122,116	8.72%	158,750	Rule 2 (~30% buffer)

Optimism USDT Comet
Symbol	Current Cap	Supply Balance	Utilization	Proposed Cap	Rule
OP	1,000,000	311,056	31.11%	404,373	Rule 2 (~30% buffer)

Optimism WETH Comet
Symbol	Current Cap	Supply Balance	Utilization	Proposed Cap	Rule
weETH	1,600	804	50.27%	1,046	Rule 2 (~30% buffer)
rETH	5,000	76	1.52%	99	Rule 2 (~30% buffer)
ezETH	3,200	212	6.63%	276	Rule 2 (~30% buffer)

*/

const cometConfig = {
  Optimism: {
    USDC: {
      address: '0x2e44e174f7D53F0212823acC11C01A11d58c5bCB',
    },
    USDT: {
      address: '0x995E394b8B2437aC8Ce61Ee0bC610D617962B214',
    },
    WETH: {
      address: '0xE36A30D249f7761327fd973001A32010b521b6Fd',
    },
  },
};

const supplyCapConfig = {
  Optimism : {
    USDC: {
      OP: {
        newCap: 158_750,
        decimals: 18,
      },
    },
    USDT: {
      OP: {
        newCap: 404_373,
        decimals: 18,
      },
    },
    WETH: {
      weETH: {
        newCap: 1_046,
        decimals: 18,
      },
      rETH: {
        newCap: 99,
        decimals: 18,
      },
      ezETH: {
        newCap: 276,
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
      opL1CrossDomainMessenger,
    } = await governanceDeploymentManager.getContracts();

    // Optimism
    const {
      bridgeReceiver: optimismBridgeReceiver,
      configurator: optimismConfigurator,
      cometAdmin: optimismCometAdmin,
      OP: optimismOP,
    } = await deploymentManager.getContracts();

    const optimismUsdcUpdateOpSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Optimism.USDC.address, optimismOP.address, exp(supplyCapConfig.Optimism.USDC.OP.newCap, supplyCapConfig.Optimism.USDC.OP.decimals)]);
    const optimismUsdcDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [optimismConfigurator.address, cometConfig.Optimism.USDC.address]);

    const optimismUsdtUpdateOpSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Optimism.USDT.address, optimismOP.address, exp(supplyCapConfig.Optimism.USDT.OP.newCap, supplyCapConfig.Optimism.USDT.OP.decimals)]);
    const optimismUsdtDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [optimismConfigurator.address, cometConfig.Optimism.USDT.address]);

    const optimismDmWeth = await deploymentManager.addBridgedDeploymentManager('optimism', 'weth', deploymentManager.hre);
    const {
      weETH: optimismWeETH,
      rETH: optimismRETH,
      ezETH: optimismEzETH,      
    } = await optimismDmWeth.getContracts();

    const optimismWethUpdateWeETHSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Optimism.WETH.address, optimismWeETH.address, exp(supplyCapConfig.Optimism.WETH.weETH.newCap, supplyCapConfig.Optimism.WETH.weETH.decimals)]);
    const optimismWethUpdateRETHSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Optimism.WETH.address, optimismRETH.address, exp(supplyCapConfig.Optimism.WETH.rETH.newCap, supplyCapConfig.Optimism.WETH.rETH.decimals)]);
    const optimismWethUpdateEzETHSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Optimism.WETH.address, optimismEzETH.address, exp(supplyCapConfig.Optimism.WETH.ezETH.newCap, supplyCapConfig.Optimism.WETH.ezETH.decimals)]);
    const optimismWethDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [optimismConfigurator.address, cometConfig.Optimism.WETH.address]);

    const optimismProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          // USDC Comet
          optimismConfigurator.address, // OP
          optimismCometAdmin.address,
          // USDT Comet
          optimismConfigurator.address, // OP
          optimismCometAdmin.address,
          // WETH Comet
          optimismConfigurator.address, // weETH
          optimismConfigurator.address, // rETH
          optimismConfigurator.address, // ezETH
          optimismCometAdmin.address,
        ],
        [
          // USDC Comet
          0, // OP
          0,
          // USDT Comet
          0, // OP
          0,
          // WETH Comet
          0, // weETH
          0, // rETH
          0, // ezETH
          0,
        ],
        [
          // USDC Comet
          'updateAssetSupplyCap(address,address,uint128)', // OP
          'deployAndUpgradeTo(address,address)',
          // USDT Comet
          'updateAssetSupplyCap(address,address,uint128)', // OP
          'deployAndUpgradeTo(address,address)',
          // WETH Comet
          'updateAssetSupplyCap(address,address,uint128)', // weETH
          'updateAssetSupplyCap(address,address,uint128)', // rETH
          'updateAssetSupplyCap(address,address,uint128)', // ezETH
          'deployAndUpgradeTo(address,address)',
        ],
        [
          // USDC Comet
          optimismUsdcUpdateOpSupplyCapCalldata,
          optimismUsdcDeployAndUpgradeToCalldata,
          // USDT Comet
          optimismUsdtUpdateOpSupplyCapCalldata,
          optimismUsdtDeployAndUpgradeToCalldata,
          // WETH Comet
          optimismWethUpdateWeETHSupplyCapCalldata,
          optimismWethUpdateRETHSupplyCapCalldata,
          optimismWethUpdateEzETHSupplyCapCalldata,
          optimismWethDeployAndUpgradeToCalldata,
        ],
      ]
    );

    const mainnetActions = [
      // 1. Optimism proposal      
      {
        contract: opL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [optimismBridgeReceiver.address, optimismProposalData, 3_000_000]
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

  async verify(deploymentManager: DeploymentManager) {
    // Optimism
    const {
      OP: optimismOP,
    } = await deploymentManager.getContracts();

    // USDC Comet
    const optimismUsdcComet = new Contract(
      cometConfig.Optimism.USDC.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await deploymentManager.getSigner()
    );

    const OPAssetInfoUsdc = await optimismUsdcComet.getAssetInfoByAddress(optimismOP.address);

    expect(OPAssetInfoUsdc.scale).to.equal(exp(1, supplyCapConfig.Optimism.USDC.OP.decimals));
    expect(OPAssetInfoUsdc.supplyCap).to.equal(exp(supplyCapConfig.Optimism.USDC.OP.newCap, supplyCapConfig.Optimism.USDC.OP.decimals));

    // USDT Comet
    const optimismUsdtComet = new Contract(
      cometConfig.Optimism.USDT.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await deploymentManager.getSigner()
    );
    const OPAssetInfoUsdt = await optimismUsdtComet.getAssetInfoByAddress(optimismOP.address);
    expect(OPAssetInfoUsdt.scale).to.equal(exp(1, supplyCapConfig.Optimism.USDT.OP.decimals));
    expect(OPAssetInfoUsdt.supplyCap).to.equal(exp(supplyCapConfig.Optimism.USDT.OP.newCap, supplyCapConfig.Optimism.USDT.OP.decimals));

    // WETH Comet
    const optimismWethComet = new Contract(
      cometConfig.Optimism.WETH.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await deploymentManager.getSigner()
    );
    const optimismDmWeth = deploymentManager.bridgedDeploymentManagers.get('optimism:weth') as DeploymentManager;
    const {
      weETH: optimismWeETH,
      rETH: optimismRETH,
      ezETH: optimismEzETH,
    } = await optimismDmWeth.getContracts();
    
    const weETHAssetInfoWeth = await optimismWethComet.getAssetInfoByAddress(optimismWeETH.address);
    const rETHAssetInfoWeth = await optimismWethComet.getAssetInfoByAddress(optimismRETH.address);
    const ezETHAssetInfoWeth = await optimismWethComet.getAssetInfoByAddress(optimismEzETH.address);

    expect(weETHAssetInfoWeth.scale).to.equal(exp(1, supplyCapConfig.Optimism.WETH.weETH.decimals));
    expect(rETHAssetInfoWeth.scale).to.equal(exp(1, supplyCapConfig.Optimism.WETH.rETH.decimals));
    expect(ezETHAssetInfoWeth.scale).to.equal(exp(1, supplyCapConfig.Optimism.WETH.ezETH.decimals));

    expect(weETHAssetInfoWeth.supplyCap).to.equal(exp(supplyCapConfig.Optimism.WETH.weETH.newCap, supplyCapConfig.Optimism.WETH.weETH.decimals));
    expect(rETHAssetInfoWeth.supplyCap).to.equal(exp(supplyCapConfig.Optimism.WETH.rETH.newCap, supplyCapConfig.Optimism.WETH.rETH.decimals));
    expect(ezETHAssetInfoWeth.supplyCap).to.equal(exp(supplyCapConfig.Optimism.WETH.ezETH.newCap, supplyCapConfig.Optimism.WETH.ezETH.decimals));
  },
});
