import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { calldata, exp, proposal } from '../../../../src/deploy';

import { expect } from 'chai';

export default migration('1674835242_bump_supply_caps', {
  async prepare(deploymentManager: DeploymentManager) {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;

    const {
      governor,
      comet,
      configurator,
      cometAdmin,
      cbETH,
    } = await deploymentManager.getContracts();

    const actions = [
      // 1. Increase supply caps for each of the assets
      {
        contract: configurator,
        signature: "updateAssetSupplyCap(address,address,uint128)",
        args: [comet.address, cbETH.address, exp(30_000, 18)],
      },

      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: "deployAndUpgradeTo(address,address)",
        args: [configurator.address, comet.address],
      },
    ];
    const description = "# Increase cbETH Supply Cap in cWETHv3\n\n## Explanation\n\nThe cWETHv3 market is currently limited by the cbETH supply cap, which has been reached.\n\nThe associated forum post for this proposal can be found [here](https://www.comp.xyz/t/compound-v3-usdc-comet-risk-parameter-updates-2023-02-08).\n\n## Proposal\n\nThe proposal itself is to be made from [this pull request](https://github.com/compound-finance/comet/pull/678).\n\nThe first action of the proposal sets the configurator supply cap for cbETH to 30,000 from the current cap of 20,000.\n\nThe second action deploys and upgrades to a new implementation of Comet, using the newly configured parameters.";
    const txn = await deploymentManager.retry(
      async () => trace((await governor.propose(...await proposal(actions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      comet,
      cbETH,
    } = await deploymentManager.getContracts();

    const cbETHInfo = await comet.getAssetInfoByAddress(cbETH.address);

    expect(await cbETHInfo.supplyCap).to.be.eq(exp(30_000, 18));
  },
});
