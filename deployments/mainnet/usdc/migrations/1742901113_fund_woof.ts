import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const STREAM_RECEIVER = '0xd36025E1e77069aA991DC24f0E6287b4A35c89Ad';

export default migration('1742901113_fund_woof', {
  async prepare(deploymentManager: DeploymentManager) {
    const _streamer = await deploymentManager.deploy(
      'streamer',
      'Streamer.sol',
      [
        STREAM_RECEIVER
      ]
    );
    return { streamer: _streamer.address };
  },

  enact: async (deploymentManager: DeploymentManager, _, { streamer }) => {
    const trace = deploymentManager.tracer();
    const {
      governor,
      comptrollerV2,
    } = await deploymentManager.getContracts();
    const mainnetActions = [
      // 1. Withdraw the stream amount from Comptroller to streamer
      {
        contract: comptrollerV2,
        signature: '_grantComp(address,uint256)',
        args: [streamer, exp(53011, 18)], // about $2.4m
      },
      // 2. Initialize the streamer
      {
        target: streamer,
        signature: 'initialize()',
        calldata: '0x',
      },
    ];
    const description = '# WOOF! <> Compound Renewal 2025\n\n## Background\n\nSince 2023, WOOF! has worked with Compound to support the new and ongoing developments.\n\nFull details of the proposal can be found [here](https://www.comp.xyz/t/woof-compound-2025/6724/).\n\n## Proposal\n\nA proposal to renew WOOF!’s 12-month engagement with Compound to support core Compound Protocol developments, addressing the evolving needs of the community, including Compound v4, staked COMP, partial liquidations, and more, while also maintaining and supporting the existing infrastructure.\n\n## Compensation Structure\n\nThe service fee structure will be a fixed annual fee of 2,000,000 USD using the COMP spot price.\n\nCOMP will be streamed via a custom solution developed by WOOF! and audited by OpenZeppelin\n\n.Specification:\n\nAllocation: 53,011 COMP\n\nStreaming Duration: 1 year (continuously, second-by-second distribution)\n\nDistribution Currency: COMP, valued in USDC via Chainlink’s COMP/USDC price feed at the moment of claim.\n\nClaiming Cap: 2,000,000 USDC.\n\nSlippage Tolerance: 0.5% applied at the time of claim.\n\nClaim Safeguard: To protect the DAO from unfavorable claim conditions, any address may execute a claim on behalf of the stream if the last claim occurred more than 7 days ago.\n\nAnyone can return unclaimed COMP to the Comptroller after the end of the stream, plus a 10-day grace period.\n\nThe stream can be canceled early via an on-chain governance vote.\n\nWOOF! will be able to withdraw the vested funds at any time.\n\nMore details can be found in the forum post.';
    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      )
    );
    const event = txn.events.find(
      (event) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      COMP,
      streamer,
    } = await deploymentManager.getContracts();

    expect(await streamer.startTimestamp()).to.be.gt(0);
    expect(await COMP.balanceOf(streamer.address)).to.be.equal(exp(53011, 18));
  },
});

