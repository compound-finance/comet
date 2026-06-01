import { expect } from 'chai';
import { Contract, utils } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

/*
// Mantle

Mantle USDe Comet
Symbol	Current Cap	Supply Balance	Utilization	Proposed Cap	Rule
mETH	3,000	1,533	51.09%	1,993	Rule 2 (~30% buffer)
FBTC	120	4	3.42%	5	Rule 2 (~25% buffer)
*/

const cometConfig = {
  Mantle: {
    USDe: {
      address: '0x606174f62cd968d8e684c645080fa694c1D7786E',
    },
  },
};

const supplyCapConfig = {
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

  async enact(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) {

    const trace = deploymentManager.tracer();

    const {
      governor,
      mantleL1CrossDomainMessenger
    } = await govDeploymentManager.getContracts();

    // Mantle
    const {
      bridgeReceiver: mantleBridgeReceiver,
      configurator: mantleConfigurator,
      cometAdmin: mantleCometAdmin,
      mETH: mantleMETH,
      FBTC: mantleFBTC,
    } = await deploymentManager.getContracts();

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
      // 1. Mantle proposal
      {
        contract: mantleL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [mantleBridgeReceiver.address, mantleProposalData, 2_500_000],
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
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    // Mantle
    const {
      mETH: mantleMETH,
      FBTC: mantleFBTC,
    } = await deploymentManager.getContracts();

    const mantleUsdeComet = new Contract(
      cometConfig.Mantle.USDe.address,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      await deploymentManager.getSigner()
    );

    const mETHAssetInfoMantleUsde = await mantleUsdeComet.getAssetInfoByAddress(mantleMETH.address);
    const FBTCAssetInfoMantleUsde = await mantleUsdeComet.getAssetInfoByAddress(mantleFBTC.address);

    expect(mETHAssetInfoMantleUsde.scale).to.equal(exp(1, supplyCapConfig.Mantle.USDe.mETH.decimals));
    expect(FBTCAssetInfoMantleUsde.scale).to.equal(exp(1, supplyCapConfig.Mantle.USDe.FBTC.decimals));

    expect(mETHAssetInfoMantleUsde.supplyCap).to.equal(exp(supplyCapConfig.Mantle.USDe.mETH.newCap, supplyCapConfig.Mantle.USDe.mETH.decimals));
    expect(FBTCAssetInfoMantleUsde.supplyCap).to.equal(exp(supplyCapConfig.Mantle.USDe.FBTC.newCap, supplyCapConfig.Mantle.USDe.FBTC.decimals));
  },
});
