import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const STREAM_RECEIVER = '0xc10785fB7b1adD4fD521A27d0d55c5561EEf0940';

export default migration('1742901113_create_stream', {
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
        args: [streamer, exp(17710, 18)],
      },
      // 2. Initialize the streamer
      {
        target: streamer,
        signature: 'initialize()',
        calldata: '0x',
      },
    ];
    const description = 'DESCRIPTION';
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
    expect(await COMP.balanceOf(streamer.address)).to.be.equal(exp(17710, 18));
  },
});

