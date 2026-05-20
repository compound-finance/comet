import { expect } from 'chai';
import { Contract, utils } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { forkedHreForBase } from '../../../../plugins/scenario/utils/hreForBase';

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

// Polygon

Polygon USDC Comet
Symbol	Current Cap	Supply Balance	Utilization	Proposed Cap	Rule
WPOL	8,000,000	377,485	4.72%	490,731	Rule 2 (~30% buffer)
MaticX	3,200,000	183,489	5.73%	238,536	Rule 2 (~30% buffer)

Polygon USDT Comet
Symbol	Current Cap	Supply Balance	Utilization	Proposed Cap	Rule
WPOL	5,000,000	155,574	3.11%	202,246	Rule 2 (~30% buffer)
MaticX	4,160,000	123,953	2.98%	161,140	Rule 2 (~30% buffer)

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
  Polygon: {
    USDC: {
      address: '0xF25212E676D1F7F89Cd72fFEe66158f541246445',
    },
    USDT: {
      address: '0xaeB318360f27748Acb200CE616E389A6C9409a07',
    },
  },
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

  async enact(deploymentManager: DeploymentManager) {

    const trace = deploymentManager.tracer();

    const {
      governor,
      fxRoot,
      opL1CrossDomainMessenger,
      unichainL1CrossDomainMessenger,
    } = await deploymentManager.getContracts();

    // Optimism
    const optimismHre = await forkedHreForBase({ name: 'optimism-usdc', network: 'optimism', deployment: 'usdc' });
    const optimismDm = await deploymentManager.addBridgedDeploymentManager('optimism', 'usdc', optimismHre);
    const {
      bridgeReceiver: optimismBridgeReceiver,
      configurator: optimismConfigurator,
      cometAdmin: optimismCometAdmin,
      OP: optimismOP,
    } = await optimismDm.getContracts();

    const optimismUsdcUpdateOpSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Optimism.USDC.address, optimismOP.address, exp(supplyCapConfig.Optimism.USDC.OP.newCap, supplyCapConfig.Optimism.USDC.OP.decimals)]);
    const optimismUsdcDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [optimismConfigurator.address, cometConfig.Optimism.USDC.address]);

    const optimismUsdtUpdateOpSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Optimism.USDT.address, optimismOP.address, exp(supplyCapConfig.Optimism.USDT.OP.newCap, supplyCapConfig.Optimism.USDT.OP.decimals)]);
    const optimismUsdtDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [optimismConfigurator.address, cometConfig.Optimism.USDT.address]);

    const optimismDmWeth = await deploymentManager.addBridgedDeploymentManager('optimism', 'weth', optimismHre);
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

    // Polygon
    const polygonHre = await forkedHreForBase({ name: 'polygon-usdc', network: 'polygon', deployment: 'usdc' });
    const polygonDm = await deploymentManager.addBridgedDeploymentManager('polygon', 'usdc', polygonHre);
    const {
      bridgeReceiver: polygonBridgeReceiver,
      configurator: polygonConfigurator,
      cometAdmin: polygonCometAdmin,
      WPOL: polygonWPOL,
      MaticX: polygonMaticX,
    } = await polygonDm.getContracts();

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

    // Unichain
    const unichainHre = await forkedHreForBase({ name: 'unichain-weth', network: 'unichain', deployment: 'weth' });
    const unichainDm = await deploymentManager.addBridgedDeploymentManager('unichain', 'weth', unichainHre);
    const {
      bridgeReceiver: unichainBridgeReceiver,
      configurator: unichainConfigurator,
      cometAdmin: unichainCometAdmin,
      UNI: unichainUNI,
      ezETH: unichainEzETH,
      weETH: unichainWeETH,
    } = await unichainDm.getContracts();

    const unichainUsdcUniUpdateSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Unichain.USDC.address, unichainUNI.address, exp(supplyCapConfig.Unichain.USDC.UNI.newCap, supplyCapConfig.Unichain.USDC.UNI.decimals)]);
    const unichainUsdcDeployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [unichainConfigurator.address, cometConfig.Unichain.USDC.address]);

    const unichainWethUniUpdateSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Unichain.WETH.address, unichainUNI.address, exp(supplyCapConfig.Unichain.WETH.UNI.newCap, supplyCapConfig.Unichain.WETH.UNI.decimals)]);
    const unichainWethEzEthUpdateSupplyCapCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint128'], [cometConfig.Unichain.WETH.address, unichainEzETH.address, exp(supplyCapConfig.Unichain.WETH.ezETH.newCap, supplyCapConfig.Unichain.WETH.ezETH.decimals)]);
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
          unichainWethUniUpdateSupplyCapCalldata,
          unichainWethEzEthUpdateSupplyCapCalldata,
          unichainWethWeEthUpdateSupplyCapCalldata,
          unichainWethDeployAndUpgradeToCalldata,
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
      // 2. Polygon proposal
      {
        contract: fxRoot,
        signature: 'sendMessageToChild(address,bytes)',
        args: [polygonBridgeReceiver.address, polygonProposalData],
      },
      // 3. Unichain proposal
      {
        contract: unichainL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [unichainBridgeReceiver.address, unichainProposalData, 3_000_000],
      },
    ];

    const description = `# Supply Cap Reduction Across L2 Comets (Part 2)

## Proposal summary

WOOF! proposes to update supply caps on cUSDCv3, cUSDTv3 and cWETHv3 on Optimism, cUSDCv3 and cUSDTv3 on Polygon, cUSDCv3 and cWETHv3 on Unichain networks. This proposal takes the governance steps recommended and necessary to update Compound III markets on each network. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters are based on the [recommendations from Gauntlet](https://www.comp.xyz/t/supply-cap-reduction-across-l2-comets/7794/1).

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1124) and [forum discussion](https://www.comp.xyz/t/supply-cap-reduction-across-l2-comets/7794).


## Proposal Actions

The first action sends a message to the Optimism network to update supply caps on the USDC, USDT and WETH Comets.

The second action sends a message to the Polygon network to update supply caps on the USDC and USDT Comets.

The third action sends a message to the Unichain network to update supply caps on the USDC and WETH Comets.
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
    const optimismDm = deploymentManager.bridgedDeploymentManagers.get('optimism:usdc') as DeploymentManager;

    const {
      OP: optimismOP,
    } = await optimismDm.getContracts();

    // USDC Comet
    const optimismUsdcComet = new Contract(
      cometConfig.Optimism.USDC.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await optimismDm.getSigner()
    );

    const OPAssetInfoUsdc = await optimismUsdcComet.getAssetInfoByAddress(optimismOP.address);

    expect(OPAssetInfoUsdc.scale).to.equal(exp(1, supplyCapConfig.Optimism.USDC.OP.decimals));
    expect(OPAssetInfoUsdc.supplyCap).to.equal(exp(supplyCapConfig.Optimism.USDC.OP.newCap, supplyCapConfig.Optimism.USDC.OP.decimals));

    // USDT Comet
    const optimismUsdtComet = new Contract(
      cometConfig.Optimism.USDT.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await optimismDm.getSigner()
    );
    const OPAssetInfoUsdt = await optimismUsdtComet.getAssetInfoByAddress(optimismOP.address);
    expect(OPAssetInfoUsdt.scale).to.equal(exp(1, supplyCapConfig.Optimism.USDT.OP.decimals));
    expect(OPAssetInfoUsdt.supplyCap).to.equal(exp(supplyCapConfig.Optimism.USDT.OP.newCap, supplyCapConfig.Optimism.USDT.OP.decimals));

    // WETH Comet
    const optimismWethComet = new Contract(
      cometConfig.Optimism.WETH.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await optimismDm.getSigner()
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

    // Polygon
    const polygonDm = deploymentManager.bridgedDeploymentManagers.get('polygon:usdc') as DeploymentManager;

    const {
      WPOL: polygonWPOL,
      MaticX: polygonMaticX,
    } = await polygonDm.getContracts();

    // USDC Comet
    const polygonUsdcComet = new Contract(
      cometConfig.Polygon.USDC.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await polygonDm.getSigner()
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
      await polygonDm.getSigner()
    );

    const WPOLAssetInfoUsdt = await polygonUsdtComet.getAssetInfoByAddress(polygonWPOL.address);
    const MaticXAssetInfoUsdt = await polygonUsdtComet.getAssetInfoByAddress(polygonMaticX.address);

    expect(WPOLAssetInfoUsdt.scale).to.equal(exp(1, supplyCapConfig.Polygon.USDT.WPOL.decimals));
    expect(WPOLAssetInfoUsdt.supplyCap).to.equal(exp(supplyCapConfig.Polygon.USDT.WPOL.newCap, supplyCapConfig.Polygon.USDT.WPOL.decimals));

    expect(MaticXAssetInfoUsdt.scale).to.equal(exp(1, supplyCapConfig.Polygon.USDT.MaticX.decimals));
    expect(MaticXAssetInfoUsdt.supplyCap).to.equal(exp(supplyCapConfig.Polygon.USDT.MaticX.newCap, supplyCapConfig.Polygon.USDT.MaticX.decimals));

    // Unichain
    const unichainDm = deploymentManager.bridgedDeploymentManagers.get('unichain:weth') as DeploymentManager;

    const {
      UNI: unichainUNI,
      ezETH: unichainEzETH,
      weETH: unichainWeETH,
    } = await unichainDm.getContracts();

    // USDC Comet
    const unichainUsdcComet = new Contract(
      cometConfig.Unichain.USDC.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await unichainDm.getSigner()
    );

    const unichainUNIAssetInfoUsdc = await unichainUsdcComet.getAssetInfoByAddress(unichainUNI.address);

    expect(unichainUNIAssetInfoUsdc.scale).to.equal(exp(1, supplyCapConfig.Unichain.USDC.UNI.decimals));
    expect(unichainUNIAssetInfoUsdc.supplyCap).to.equal(exp(supplyCapConfig.Unichain.USDC.UNI.newCap, supplyCapConfig.Unichain.USDC.UNI.decimals));

    // WETH Comet
    const unichainWethComet = new Contract(
      cometConfig.Unichain.WETH.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await unichainDm.getSigner()
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
