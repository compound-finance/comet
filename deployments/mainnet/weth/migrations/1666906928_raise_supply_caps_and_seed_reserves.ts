import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { calldata, exp, proposal } from '../../../../src/deploy';

import { expect } from 'chai';

export default migration('1666906928_raise_supply_caps_and_seed_reserves', {
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
      wstETH,
      cbETH,
    } = await deploymentManager.getContracts();

    const actions = [
      // 1. Increase supply caps for each of the assets
      {
        contract: configurator,
        signature: "updateAssetSupplyCap(address,address,uint128)",
        args: [comet.address, wstETH.address, exp(60_000, 18)],
      }, {
        contract: configurator,
        signature: "updateAssetSupplyCap(address,address,uint128)",
        args: [comet.address, cbETH.address, exp(66_000, 18)],
      },

      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: "deployAndUpgradeTo(address,address)",
        args: [configurator.address, comet.address],
      },

      // 3. Wrap ETH as WETH and send from Timelock to Comet to seed reserves
      {
        contract: WETH,
        signature: "deposit()",
        args: [],
        value: exp(1_000, 18)
      }, {
        contract: WETH,
        signature: "transfer(address,uint256)",
        args: [comet.address, exp(1_000, 18)],
      },
    ];
    const description = "# Initialize cWETHv3 on Ethereum"
    const txn = await deploymentManager.retry(
      async () => trace((await governor.propose(...await proposal(actions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },


  async verify(deploymentManager: DeploymentManager) {
    const {
      comet,
      WETH,
      wstETH,
      cbETH,
    } = await deploymentManager.getContracts();

    // 1. & 2.
    const wstETHInfo = await comet.getAssetInfoByAddress(wstETH.address);
    expect(wstETHInfo.supplyCap).to.be.equal(exp(60_000, 18));

    const cbETHInfo = await comet.getAssetInfoByAddress(cbETH.address);
    expect(cbETHInfo.supplyCap).to.be.equal(exp(66_000, 18));

    // 3.
    expect(await WETH.balanceOf(comet.address)).to.be.equal(exp(1_000, 18));
  },
});
