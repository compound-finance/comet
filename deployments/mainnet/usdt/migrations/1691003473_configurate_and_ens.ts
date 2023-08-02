import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';

import { expect } from 'chai';

interface Vars { };
const COMPAddress = '0xc00e94cb662c3520282e6f5717214004a7f26888';

export default migration('1691003473_configurate_and_ens', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, vars: Vars) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;

    const comptrollerV2 = await deploymentManager.fromDep('comptrollerV2', 'mainnet', 'usdc');
    const cometFactory = await deploymentManager.fromDep('cometFactory', 'mainnet', 'usdc');
    const {
      governor,
      comet,
      configurator,
      cometAdmin,
      rewards,
    } = await deploymentManager.getContracts();

    const configuration = await getConfigurationStruct(deploymentManager);

    const actions = [
      // 1. Set v2 cETH speeds to 0
      // {
      //   contract: comptrollerV2,
      //   signature: '_setCompSpeeds(address[],uint256[],uint256[])',
      //   args: [[cETHAddress], [0], [0]],
      // },

      // 2. Set the factory in the Configurator
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [comet.address, cometFactory.address],
      },

      // 3. Set the configuration in the Configurator
      {
        contract: configurator,
        signature: 'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
        args: [comet.address, configuration],
      },

      // 4. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: "deployAndUpgradeTo(address,address)",
        args: [configurator.address, comet.address],
      },

      // 5. Set the rewards configuration to COMP
      {
        contract: rewards,
        signature: "setRewardConfig(address,address)",
        args: [comet.address, COMPAddress],
      },

      // 8. Transfer COMP
      // {
      //   contract: comptrollerV2,
      //   signature: '_grantComp(address,uint256)',
      //   args: [rewards.address, exp(25_000, 18)],
      // },
    ];
    const description = "# Initialize cUSDTv3\n";
    const txn = await deploymentManager.retry(
      async () => trace((await governor.propose(...await proposal(actions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  }
});
