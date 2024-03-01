import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { exp, getConfigurationStruct, proposal } from '../../../../src/deploy';

import { expect } from 'chai';

const COMPAddress = '0xA6c8D1c55951e8AC44a0EaA959Be5Fd21cc07531';

export default migration('1709094543_initialize_market', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();

    // Import shared contracts from cUSDCv3
    const cometFactory = await deploymentManager.fromDep('cometFactory', 'sepolia', 'usdc');

    const {
      governor,
      comet,
      configurator,
      cometAdmin,
      rewards,
    } = await deploymentManager.getContracts();

    const configuration = await getConfigurationStruct(deploymentManager);

    const actions = [
      // 1. Set the factory in the Configurator
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [comet.address, cometFactory.address],
      },

      // 2. Set the configuration in the Configurator
      {
        contract: configurator,
        signature: 'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
        args: [comet.address, configuration],
      },

      // 3. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: "deployAndUpgradeTo(address,address)",
        args: [configurator.address, comet.address],
      },

      // 4. Set the rewards configuration to COMP
      {
        contract: rewards,
        signature: "setRewardConfig(address,address)",
        args: [comet.address, COMPAddress],
      },
    ];
    const description = "# Initialize cWETHv3 on Sepolia"
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
      rewards,
      wstETH,
      cbETH,
    } = await deploymentManager.getContracts();
    // 2. & 3.
    expect(await comet.baseTrackingSupplySpeed()).to.be.equal(exp(1 / 86400, 15, 18)); // ~ 1 COMP / day
    expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(0);

    const wstETHInfo = await comet.getAssetInfoByAddress(wstETH.address);
    expect(wstETHInfo.supplyCap).to.be.equal(exp(80_000, 18)); // ~ $100M / $1225

    const cbETHInfo = await comet.getAssetInfoByAddress(cbETH.address);
    expect(cbETHInfo.supplyCap).to.be.equal(exp(9_000, 18)); // ~ $10M / $1091

    // 4.
    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(COMPAddress);
    expect(config.rescaleFactor).to.be.equal(1000000000000n);
    expect(config.shouldUpscale).to.be.equal(true);
  },
});