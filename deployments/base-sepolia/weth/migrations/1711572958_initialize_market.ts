import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { diffState, getCometConfig } from '../../../../plugins/deployment_manager/DiffState';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';
import { expect } from 'chai';

const baseSepoliaCOMPAddress = '0x2f535da74048c0874400f0371Fba20DF983A56e2';

export default migration('1711572958_initialize_market', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, vars: Vars) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;
    const { utils } = ethers;

    const cometFactory = await deploymentManager.fromDep('cometFactory', 'base-sepolia', 'usdc');
    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      rewards,
      configurator,
    } = await deploymentManager.getContracts();

    const {
      baseL1CrossDomainMessenger,
      governor,
    } = await govDeploymentManager.getContracts();

    const configuration = await getConfigurationStruct(deploymentManager);
    const setFactoryCalldata = await calldata(
      configurator.populateTransaction.setFactory(comet.address, cometFactory.address)
    );
    const setConfigurationCalldata = await calldata(
      configurator.populateTransaction.setConfiguration(comet.address, configuration)
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );
    const setRewardConfigCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [comet.address, baseSepoliaCOMPAddress]
    );
    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [ configurator.address, configurator.address, cometAdmin.address, rewards.address ],
        [ 0, 0, 0, 0 ],
        [
          'setFactory(address,address)',
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)',
          'setRewardConfig(address,address)',
        ],
        [
          setFactoryCalldata,
          setConfigurationCalldata,
          deployAndUpgradeToCalldata,
          setRewardConfigCalldata
        ]
      ]
    );

    const sepoliaActions = [
      // 1. Set Comet configuration, deployAndUpgradeTo new Comet, set reward config
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [ bridgeReceiver.address, l2ProposalData, 2_500_000 ]
      },
    ];

    const description = "# Configure Base-Sepolia cWETHv3 market, set rewards config.";
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(sepoliaActions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async verify(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, preMigrationBlockNumber: number) {
    const ethers = deploymentManager.hre.ethers;
    await deploymentManager.spider(); // We spider here to pull in Optimism COMP now that reward config has been set

    const {
      comet,
      rewards,
      COMP,
    } = await deploymentManager.getContracts();

    // 1.
    const stateChanges = await diffState(comet, getCometConfig, preMigrationBlockNumber);

    expect(stateChanges).to.deep.equal({
      pauseGuardian: '0x6106DA3AcFdEB341808f4DC3D2483eC67c98E728',
      baseTrackingSupplySpeed: exp(2 / 86400, 16, 18),
      // baseTrackingBorrowSpeed: exp(0, 16, 18),
      baseBorrowMin: exp(0.000001, 18),
      cbETH: {
        supplyCap: exp(7500, 18)
      },
    });
  }
});