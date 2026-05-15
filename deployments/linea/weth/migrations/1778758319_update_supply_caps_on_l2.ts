import { expect } from 'chai';
import { Contract, utils } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

/*
// Linea

Linea WETH Comet
Symbol	Current Cap	Supply Balance	Utilization	Proposed Cap	Rule
ezETH	4,830	8	0.16%	0	Rule 1
weETH	3,550	93	2.63%	121	Rule 2 (~30% buffer)

*/

const cometConfig = {
  Linea: {
    WETH: {
      address: '0x60F2058379716A64a7A5d29219397e79bC552194',
    },
  },
};

const supplyCapConfig = {
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
};


export default migration('1778758319_update_supply_caps_on_l2', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) {

    const trace = deploymentManager.tracer();

    const {
      governor,
      lineaMessageService,
    } = await govDeploymentManager.getContracts();

    // Linea
    const {
      bridgeReceiver: lineaBridgeReceiver,
      configurator: lineaConfigurator,
      cometAdmin: lineaCometAdmin,
      ezETH: lineaEzETH,
      weETH: lineaWeETH,
    } = await deploymentManager.getContracts();

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

    const mainnetActions = [
      // 1. Linea proposal
      {
        contract: lineaMessageService,
        signature: 'sendMessage(address,uint256,bytes)',
        args: [lineaBridgeReceiver.address, 0, lineaProposalData],
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
    // Linea
    const {
      ezETH: lineaEzETH,
      weETH: lineaWeETH,
    } = await deploymentManager.getContracts();
    
    const lineaWethComet = new Contract(
      cometConfig.Linea.WETH.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await deploymentManager.getSigner()
    );

    const ezETHAssetInfoLineaWeth = await lineaWethComet.getAssetInfoByAddress(lineaEzETH.address);
    const weETHAssetInfoLineaWeth = await lineaWethComet.getAssetInfoByAddress(lineaWeETH.address);

    expect(ezETHAssetInfoLineaWeth.scale).to.equal(exp(1, supplyCapConfig.Linea.WETH.ezETH.decimals));
    expect(weETHAssetInfoLineaWeth.scale).to.equal(exp(1, supplyCapConfig.Linea.WETH.weETH.decimals));

    expect(ezETHAssetInfoLineaWeth.supplyCap).to.equal(exp(supplyCapConfig.Linea.WETH.ezETH.newCap, supplyCapConfig.Linea.WETH.ezETH.decimals));
    expect(weETHAssetInfoLineaWeth.supplyCap).to.equal(exp(supplyCapConfig.Linea.WETH.weETH.newCap, supplyCapConfig.Linea.WETH.weETH.decimals));
  },
});
