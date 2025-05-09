import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { Contract, utils, constants } from 'ethers';

const STREAM_RECEIVER = '0xd36025E1e77069aA991DC24f0E6287b4A35c89Ad';
const DELEGATE_RECEIVER = '0xd2a79f263ec55dbc7b724ecc20fc7448d4795a0c';
const FRANCHISER_FACTORY = '0xE696d89f4F378772f437F01FaaD70240abdf1854';

let delegateBefore;

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
      timelock,
      governor,
      comptrollerV2,
      COMP
    } = await deploymentManager.getContracts();
    delegateBefore = await COMP.getCurrentVotes(DELEGATE_RECEIVER);
    const mainnetActions = [
      // 1. Withdraw the stream amount from Comptroller to streamer
      {
        contract: comptrollerV2,
        signature: '_grantComp(address,uint256)',
        args: [streamer, exp(53475, 18)], // about $2.4m
      },
      // 2. Initialize the streamer
      {
        target: streamer,
        signature: 'initialize()',
        calldata: '0x',
      },
      // 3. Withdraw the delegate amount from Comptroller to the timelock
      {
        contract: comptrollerV2,
        signature: '_grantComp(address,uint256)',
        args:  [timelock.address, exp(50_000, 18)],
      },
      // 4. Approve the franchiser factory to spend the delegate amount
      {
        contract: COMP,
        signature: 'approve(address,uint256)',
        args:  [FRANCHISER_FACTORY, exp(50_000, 18)],
      },
      // 5. Create a Franchiser to delegate
      {
        target: FRANCHISER_FACTORY,
        signature: 'fund(address,uint256)',
        calldata:  utils.defaultAbiCoder.encode(['address', 'uint256'], [DELEGATE_RECEIVER, exp(50_000, 18)]),
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
      timelock,
      streamer,
    } = await deploymentManager.getContracts();

    const franchiserFactory = new Contract(
      FRANCHISER_FACTORY,
      [
        'function fundMany(address[] calldata delegatees, uint256[] calldata amounts) external returns(address[] memory franchisers)',
        'function getFranchiser(address,address) external view returns(address)',
      ],
      await deploymentManager.getSigner()
    );
    const franchiserAddress = await deploymentManager.retry(
      async () => await franchiserFactory.getFranchiser(timelock.address, DELEGATE_RECEIVER)
    );
    expect(franchiserAddress).to.be.not.equal(constants.AddressZero);
    expect(await COMP.balanceOf(franchiserAddress)).to.be.equal(exp(50_000, 18));
    expect(await COMP.getCurrentVotes(DELEGATE_RECEIVER)).to.be.equal(BigInt(delegateBefore) + exp(50_000, 18));
  
    expect(await streamer.startTimestamp()).to.be.gt(0);
    expect(await COMP.balanceOf(streamer.address)).to.be.equal(exp(53475, 18));
  },
});

