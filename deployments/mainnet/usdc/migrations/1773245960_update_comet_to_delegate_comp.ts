import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';
import { ethers } from 'ethers';
import { Contract } from 'ethers';

const USDT_COMET = '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840';

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

    const cometUSDC = new Contract(
      comet.address,
      [
        'function updateDelegationTarget(address) external'
      ],
      await deploymentManager.getSigner()
    );

    const cometUSDT = new Contract(
      USDT_COMET,
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
      // 2. Set the factory in the Configurator for the USDT comet
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [USDT_COMET, cometFactoryWithCOMPDelegation],
      },
      // 3. Deploy and upgrade to a new version of Comet for the USDC comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
      // 4. Deploy and upgrade to a new version of Comet for the USDT comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, USDT_COMET],
      },
      // 5. Set new CometExt as the extension delegate for the USDC comet
      {
        contract: cometUSDC,
        signature: 'updateDelegationTarget(address)',
        args: [initialDelegationTarget],
      },
      // 6. Set new CometExt as the extension delegate for the USDT comet
      {
        contract: cometUSDT,
        signature: 'updateDelegationTarget(address)',
        args: [initialDelegationTarget],
      },
    ];

    const description = `# Upgrade cUSDCv3 and cUSDTv3 on Ethereum to delegate COMP votes

## Proposal summary

WOOF! proposes upgrading cUSDCv3 and cUSDTv3 on Ethereum to a new Comet implementation that supports COMP vote delegation. The Comet markets hold COMP tokens as collateral, and currently those tokens' voting power is unused. This proposal deploys a new Comet factory, upgrades both markets, and delegates their COMP voting power to an address appointed by governance. A new governor-only \`updateDelegationTarget\` function allows governance to change the delegation target in the future.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1098) and [forum discussion](https://www.comp.xyz/t/<>).


## Proposal Actions

The first action sets the factory for cUSDCv3 to the new one that supports COMP delegation.

The second action sets the factory for cUSDTv3 to the new one that supports COMP delegation.

The third action deploys and upgrades cUSDCv3 to a new version.

The fourth action deploys and upgrades cUSDTv3 to a new version.

The fifth action calls \`updateDelegationTarget\` on cUSDCv3 to delegate its COMP voting power.

The sixth action calls \`updateDelegationTarget\` on cUSDTv3 to delegate its COMP voting power.`;
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

    const delegationTargetUSDT = await COMP.delegates(USDT_COMET);
    expect(delegationTargetUSDT).to.not.be.equal(ethers.constants.AddressZero);
  },
});
