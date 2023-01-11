import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { exp, proposal } from '../../../../src/deploy';

import { expect } from 'chai';

// XXX boilerplate for a proposal; NOT production ready
//  must be tested and analyzed
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
    const description = "# XXX DAI DSR Title\n\nXXX"; // XXX write me
    const txn = await deploymentManager.retry(
      async () => trace((await governor.propose(...await proposal(actions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      timelock,
    } = await deploymentManager.getContracts();

    // XXX basic sanity checks on steps 1. and 2.?
  },
});
