import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { calldata, exp, proposal } from '../../../../src/deploy';

import { expect } from 'chai';

const andrew = '0x2Ae8c972fB2E6c00ddED8986E2dc672ED190DA06';

export default migration('1665028496_absorb_transfer_event', {
  async prepare(deploymentManager: DeploymentManager) {
    const cometFactory = await deploymentManager.deploy('cometFactory', 'CometFactory.sol', [], true);
    return { newFactoryAddress: cometFactory.address };
  },

  async enact(deploymentManager: DeploymentManager, { newFactoryAddress }) {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;

    const {
      governor,
      comptrollerV2,
      comet,
      configurator,
      cometAdmin,
      COMP,
    } = await deploymentManager.getContracts();

    const actions = [
      // 1. Set comet factory to newly deployed factory
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [comet.address, newFactoryAddress],
      },

      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },

      // 3. Transfer COMP to Andrew
      {
        contract: comptrollerV2,
        signature: '_grantComp(address,uint256)',
        args: [andrew, exp(10, 18)],
      },
    ];
    const description = "# Liquidation Event Handling\n\nWhen a user is liquidated in Compound III, all of their collateral is absorbed into the protocol, and they are typically left with a positive balance of the base asset (USDC) and no debt (or collateral dust).\n\nShortly after the first market launched, [a community developer noticed](https://twitter.com/andrewhong5297/status/1568994083380535296) that the `absorb` function was missing an event log in the case when an account is left with a positive balance.\n\nWhile this doesn\u2019t have any economic impact, adding this event log will improve the user experience on Etherscan and blockchain explorers, and make analytics easier.\n\nThe associated forum post for this proposal can be found [here](https://www.comp.xyz/t/liquidation-event-handling/3684).\n\n**Proposal**\n\nThe proposal itself is to be made from [this pull request](https://github.com/compound-finance/comet/pull/596). \n\nThe first step is to deploy a new CometFactory, using the patched version of the contract, which adds the Transfer event to `absorb`. This is done as a \u2018prepare\u2019 step of the migration script.\n\nThe first action of the proposal is to set the factory for cUSDCv3 to the newly deployed factory.\n\nThe second action is to deploy and upgrade to a new implementation of Comet, using the newly configured factory.\n\nThe third action is to transfer 10 COMP to ilemi.eth (0x2Ae8c972fB2E6c00ddED8986E2dc672ED190DA06), as a reward for identifying the issue and suggesting the improvement.\n";
    const txn = await deploymentManager.retry(
      async () => governor.propose(...await proposal(actions, description))
    );
    trace(txn);

    const event = (await txn.wait()).events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      governor,
      comet,
      configurator,
      rewards,
      COMP,
    } = await deploymentManager.getContracts();

    // 1. & 2.
    // XXX check absorb transfer event? at least check factory and comet impl changed here

    // 3.
    expect(await COMP.balanceOf(andrew)).to.be.equal(exp(10, 18));
  }
});
