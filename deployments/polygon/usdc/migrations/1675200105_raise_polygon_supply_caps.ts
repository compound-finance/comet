import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { expect } from 'chai';

export default migration('1675200105_raise_polygon_supply_caps', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, governanceDeploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;
    const { utils } = ethers;

    const {
      fxRoot,
      governor
    } = await governanceDeploymentManager.getContracts();

    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
      WBTC,
      WETH,
      WMATIC
    } = await deploymentManager.getContracts();

    const wbtcCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint128'],
      [comet.address, WBTC.address, exp(10_000, 8)] // XXX add actual amount
    );
    const wethCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint128'],
      [comet.address, WETH.address, exp(10_000, 18)] // XXX add actual amount
    );
    const wmaticCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint128'],
      [comet.address, WMATIC.address, exp(10_000, 18)] // XXX add actual amount
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          configurator.address,
          configurator.address,
          cometAdmin.address
        ],
        [0, 0, 0, 0],
        [
          "updateAssetSupplyCap(address,address,uint128)",
          "updateAssetSupplyCap(address,address,uint128)",
          "updateAssetSupplyCap(address,address,uint128)",
          "deployAndUpgradeTo(address,address)",
        ],
        [
          wbtcCalldata,
          wethCalldata,
          wmaticCalldata,
          deployAndUpgradeToCalldata
        ]
      ]
    );

    const mainnetActions = [
      {
        contract: fxRoot,
        signature: 'sendMessageToChild(address,bytes)',
        args: [bridgeReceiver.address, l2ProposalData],
      }
    ];

    const description = ""; // XXX add description
    const txn = await governanceDeploymentManager.retry(
      async () => trace((await governor.propose(...await proposal(mainnetActions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      comet,
      WBTC,
      WETH,
      WMATIC
    } = await deploymentManager.getContracts();

    const wbtcInfo = await comet.getAssetInfoByAddress(WBTC.address);
    const wethInfo = await comet.getAssetInfoByAddress(WETH.address);
    const wmaticInfo = await comet.getAssetInfoByAddress(WMATIC.address);

    expect(await wbtcInfo.supplyCap).to.be.eq(exp(10_000, 8));
    expect(await wethInfo.supplyCap).to.be.eq(exp(10_000, 18));
    expect(await wmaticInfo.supplyCap).to.be.eq(exp(10_000, 18));
  },
});
