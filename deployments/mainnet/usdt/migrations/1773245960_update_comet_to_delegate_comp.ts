import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';
import { ethers } from 'ethers';
import { Contract } from 'ethers';

const initialDelegationTarget = '0xd2A79F263eC55DBC7B724eCc20FC7448D4795a0C';

export default migration('1773245960_update_comet_to_delegate_comp', {
  async prepare(deploymentManager: DeploymentManager) {
    const cometFactoryWithCOMPDelegation = await deploymentManager.deploy(
      'CometFactoryWithCOMPDelegation',
      'CometFactoryWithCOMPDelegation.sol',
      []
    );

    return {
      cometFactoryWithCOMPDelegation: cometFactoryWithCOMPDelegation.address
    };
  },

  async enact(deploymentManager: DeploymentManager, _, {
    cometFactoryWithCOMPDelegation
  }) {

    const trace = deploymentManager.tracer();
    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const cometWithDelegation = new Contract(
      comet.address,
      [
        'function updateDelegationTarget(address) external'
      ],
      await deploymentManager.getSigner()
    );

    const mainnetActions = [
      // 1. Set the factory in the Configurator for the USDC comet
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [comet.address, cometFactoryWithCOMPDelegation],
      },
      // 2. Deploy and upgrade to a new version of Comet for the USDC comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
      // 3. Set new CometExt as the extension delegate for the USDC comet
      {
        contract: cometWithDelegation,
        signature: 'updateDelegationTarget(address)',
        args: [initialDelegationTarget],
      },
    ];

    const description = '\n\n\n\n\n\n\n\n\nDESCRIPTION\n\n\n\n\n\n\n\n\n';
    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      ), 0, 300_000
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
    const { comet, COMP } = await deploymentManager.getContracts();

    const delegationTargetUSDC = await COMP.delegates(comet.address);
    expect(delegationTargetUSDC).to.not.be.equal(ethers.constants.AddressZero);
  },
});
