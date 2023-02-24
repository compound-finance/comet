import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { exp, proposal } from '../../../../src/deploy';

import { expect } from 'chai';

/*
 * Code for setting up proposal to roll back the cDAI implementation to
 * the state before proposal #34 passed; reinstating
 * - old cDAI delegate contract
 * - old DAIInterestRateModelV3
 *
 * This re-enables DSR usage for the underlying DAI balance of cDAI.
 */
const cDAIDelegateAddress = '0xbB8bE4772fAA655C255309afc3c5207aA7b896Fd';
const ogDAIIRModelAddress = '0xfeD941d39905B23D6FAf02C8301d40bD4834E27F';
const cDAIAddress = '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643';
const DAIAddress = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const DAIJoinAddress = '0x9759A6Ac90977b93B58547b4A71c78317f391A28';
const DAIPotAddress = '0x197E90f9FAD81970bA7976f33CbD77088E5D7cf7';

export default migration('1673462854_v2_dai_dsr_restore', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;

    const {
      governor,
      comptrollerV2,
    } = await deploymentManager.getContracts();

    const actions = [
      // 1. Set cToken implementation to the CDaiDelegate
      {
        target: cDAIAddress,
        signature: '_setImplementation(address,bool,bytes)',
        calldata: ethers.utils.defaultAbiCoder.encode(['address', 'bool', 'bytes'], [
          cDAIDelegateAddress,
          true,
          ethers.utils.defaultAbiCoder.encode(['address', 'address'], [
            DAIJoinAddress,
            DAIPotAddress
          ]),
        ]),
      },

      // 2. Set IR model to the DAIInterestRateModelV3
      {
        target: cDAIAddress,
        signature: '_setInterestRateModel(address)',
        calldata: ethers.utils.defaultAbiCoder.encode(['address'], [ogDAIIRModelAddress]),
      },
    ];
    const description = "# Reinstate Dai Savings Rate for cDAI\nOn December 21, 2020, [Proposal 34](https://compound.finance/governance/proposals/34) was created with the goal of reducing gas costs for Compound users by removing support for the MakerDAO DSR (Dai Savings Rate), as it was set at 0.01% yield by Maker Governance at the time.\nRecently, Maker [has reinstated the DSR's yield](https://vote.makerdao.com/executive/template-executive-vote-recognized-delegate-compensation-gno-onboarding-blocktower-credit-rwa-vaults-onboarding-renbtc-offboarding-mkr-vesting-momc-parameter-changes-dai-savings-rate-adjustment-starknet-bridge-parameter-changes-december-09-2022#proposal-detail) at an annualized 1%. This is independent of the amount of DAI deposited.\nWe propose rolling back cDAI’s implementation and its corresponding IRM (Interest Rate Model) to their previous deployed versions. This implementation reconnects the Dai Savings Rate to the Compound’s protocol cDAI system.\nThis will allow cDAI holders and the greater Compound community to be able to utilize the underlying yield provided by MakerDAO.\nThe end result of this proposal will be more yield for cDAI holders, at the cost of slightly higher gas usage. This proposal has been simulated on a network fork, and uses contracts that have been previously part of Compound's system.\nMore discussions might be needed in the community on whether the `DAIInterestRateModelV3` is to be updated to a newer version, but that is outside the scope of this proposal.\nFor more information, see [this post](https://www.comp.xyz/t/compound-dsr-proposal/3856) on the Compound governance forums.";
    const txn = await deploymentManager.retry(
      async () => trace((await governor.propose(...await proposal(actions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async verify(deploymentManager: DeploymentManager) {
    // 1.
    const cDAI = await deploymentManager.existing("cDAI", cDAIAddress);
    const implementation = await cDAI.implementation();
    expect(implementation).to.be.equal(cDAIDelegateAddress);
    
    // 2.
    const DAIInterestRateModel = await cDAI.interestRateModel();
    expect(DAIInterestRateModel).to.be.equal(ogDAIIRModelAddress);
  },
});
