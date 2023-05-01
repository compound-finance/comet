import { Contract } from 'ethers';
import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { calldata, exp, proposal } from '../../../../src/deploy';

import { expect } from 'chai';

const ERC20PredicateAddress = '0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf';
const RootChainManagerAddress = '0xA0c68C638235ee32657e8f720a23ceC1bFc77C77';

export default migration('1681313581_more_comp', {
  async prepare(deploymentManager: DeploymentManager) {
    return {};
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;

    const {
      governor,
      comptrollerV2,
      COMP,
    } = await govDeploymentManager.getContracts();

    const {
      rewards,
    } = await deploymentManager.getContracts();

    const RootChainManager = await govDeploymentManager.existing(
      'RootChainManager',
      RootChainManagerAddress
    );
    const COMPAmountToBridge = exp(12_500, 18);
    const depositCOMPData = ethers.utils.defaultAbiCoder.encode(['uint256'], [COMPAmountToBridge]);
    const depositForCOMPCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'bytes'],
      [rewards.address, COMP.address, depositCOMPData]
    );

    const actions = [
      // 1. Approve Polygon's ERC20Predicate to take Timelock's COMP (for bridging)
      {
        contract: COMP,
        signature: 'approve(address,uint256)',
        args: [ERC20PredicateAddress, COMPAmountToBridge]
      },
      // 2. Bridge COMP from mainnet to Polygon CometRewards using RootChainManager
      {
        target: RootChainManager.address,
        signature: 'depositFor(address,address,bytes)',
        calldata: depositForCOMPCalldata
      },
    ];
    const description = "# Refresh Polygon COMP\n\nThis is a repost of [Proposal 158](https://compound.finance/governance/proposals/158), given that the proposal failed to reach quorum. More discussions can be found on this [forum thread](https://www.comp.xyz/t/refresh-comp-rewards-on-polygon/4253).\n\n## Explanation\n\nSince the launch of cUSDCv3 on Polygon mainnet a month ago, the market has grown steadily and proven to be in good order. The initial seeding of rewards only provisioned enough for a few months, as a conservative starting point. Now is a good time to renew the COMP rewards going to the market.\n\nThis proposal bridges an additional 12,500 COMP to sustain the current rewards speeds of the market for an additional year (approximately).\n\n## Proposal\n\nThe proposal itself is to be made from [this pull request](https://github.com/compound-finance/comet/pull/735). \n\nThe first action approves the transfer of COMP by the Polygon bridge contract.\n\nThe second action triggers the transfer across the bridge to the rewards contract.";
    const txn = await deploymentManager.retry(
      async () => governor.propose(...await proposal(actions, description))
    );
    trace(txn);

    const event = (await txn.wait()).events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      rewards,
      COMP,
    } = await deploymentManager.getContracts();

    // 1. & 2.
    expect(await COMP.balanceOf(rewards.address)).to.be.greaterThan(exp(12_500, 18));
  },
});
