import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { calldata, exp, proposal } from '../../../../src/deploy';

import { expect } from 'chai';

export default migration('1669668117_raise_weth_supply_cap', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;

    const {
      governor,
      comet,
      configurator,
      cometAdmin,
      WETH,
    } = await deploymentManager.getContracts();

    const actions = [
      // 1. Increase supply cap for WETH
      {
        contract: configurator,
        signature: "updateAssetSupplyCap(address,address,uint128)",
        args: [comet.address, WETH.address, exp(150_000, 18)],
      },

      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: "deployAndUpgradeTo(address,address)",
        args: [configurator.address, comet.address],
      },
    ];
    const description = "# Increase WETH Supply Cap in cUSDCv3\n\n## Explanation\n\nThe cUSDCv3 market is currently limited by the WETH supply cap, which has been reached. Since setting these caps (in units of each collateral asset), prices of collateral assets have decreased, effectively lowering the current caps, while usage has grown.\n\nThe associated forum post for this proposal can be found [here](https://www.comp.xyz/t/increase-eth-supply-cap-in-usdc-comet-market/3817).\n\n## Proposal\n\nThe proposal itself is to be made from [this pull request](https://github.com/compound-finance/comet/pull/631).\n\nThe first action of the proposal sets the configurator supply cap for WETH to 150,000, twice the current cap of 75,000.\n\nThe second action deploys and upgrades to a new implementation of Comet, using the newly configured parameters.\n"
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
      WETH,
    } = await deploymentManager.getContracts();

    const wethInfo = await comet.getAssetInfoByAddress(WETH.address);

    expect(await wethInfo.supplyCap).to.be.eq(exp(150_000, 18));
  },
});
