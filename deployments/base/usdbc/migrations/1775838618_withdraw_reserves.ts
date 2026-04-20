import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { utils, Contract, BigNumber } from 'ethers';

const withdrawConfig = {
  cUSDbCv3: {
    address: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf',
    assetL1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    assetL2: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
    amount: 120_512,
    decimals: 6,
  },
};

const recipient = '0xDcB34b56842F853A69E86De5A0c22c49d97C130C';

let balancesBefore: Record<string, BigNumber> = {};

async function getErc20FromAddress(dm: DeploymentManager, address: string, ): Promise<Contract> {
  return new Contract(address, ['function balanceOf(address) view returns (uint256)'], await dm.getSigner());
}

export default migration('1775838618_withdraw_reserves', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) {
    const trace = deploymentManager.tracer();

    const {
      bridgeReceiver,
      timelock: l2Timelock,
      l2StandardBridge
    } = await deploymentManager.getContracts();

    const {
      governor,
      baseL1CrossDomainMessenger
    } = await govDeploymentManager.getContracts();

    const withdrawUSDbCCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [l2Timelock.address, exp(withdrawConfig.cUSDbCv3.amount, withdrawConfig.cUSDbCv3.decimals)]
    );

    const approveUSDbCCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [l2StandardBridge.address, exp(withdrawConfig.cUSDbCv3.amount, withdrawConfig.cUSDbCv3.decimals)]
    );

    const bridgeERC20ToCCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'address', 'uint256', 'uint32', 'bytes'],
      [
        withdrawConfig.cUSDbCv3.assetL2, // _localToken
        withdrawConfig.cUSDbCv3.assetL1, // _remoteToken
        recipient, // _to
        exp(withdrawConfig.cUSDbCv3.amount, withdrawConfig.cUSDbCv3.decimals), // _amount
        200000, // _minGasLimit
        '0x', // _data
      ]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          withdrawConfig.cUSDbCv3.address,
          withdrawConfig.cUSDbCv3.assetL2,
          l2StandardBridge.address,
        ],
        [
          0, 0, 0,
        ],
        [
          'withdrawReserves(address,uint256)',
          'approve(address,uint256)',
          'bridgeERC20To(address,address,address,uint256,uint32,bytes)'
        ],
        [
          withdrawUSDbCCalldata,
          approveUSDbCCalldata,
          bridgeERC20ToCCalldata,
        ]
      ]
    );


    const mainnetActions = [
      // Send the proposal to the L2 bridge
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000]
      },
    ];

    const USDC = await getErc20FromAddress(govDeploymentManager, withdrawConfig.cUSDbCv3.assetL1);
    
    balancesBefore = {
      USDC: await USDC.balanceOf(recipient),
      ETH: BigNumber.from(await govDeploymentManager.hre.ethers.provider.getBalance(recipient)),
    };

    const description = `# Withdraw reserves from cUSDbCv3 market on Base 

## Proposal summary

Recipient address: ${recipient}

## Proposal actions

The first proposal action sends a message to the Base bridgeReceiver to execute a proposal on L2, which will:
- Withdraw 120,512 USDbC from the cUSDbCv3 market on Base
- Send the withdrawn USDbC to the L2 timelock, which will then send the withdrawn tokens from L2 to L1 using the native Base bridge.
`;
    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      ), 0, 600_000
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

  async verify(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) {
    const USDC = await getErc20FromAddress(govDeploymentManager, withdrawConfig.cUSDbCv3.assetL1);

    const balancesAfter = {
      USDC: await USDC.balanceOf(recipient),
    };

    expect(balancesAfter.USDC.sub(balancesBefore.USDC)).to.equal(exp(withdrawConfig.cUSDbCv3.amount, withdrawConfig.cUSDbCv3.decimals) + exp(withdrawConfig.cUSDbCv3.amount, withdrawConfig.cUSDbCv3.decimals));
  },
});
