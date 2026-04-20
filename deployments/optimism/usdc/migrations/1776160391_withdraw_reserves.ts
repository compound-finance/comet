import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { utils, Contract, BigNumber } from 'ethers';

const withdrawConfig = {
  cUSDCv3: {
    address: '0x2e44e174f7D53F0212823acC11C01A11d58c5bCB',
    assetL1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    assetL2: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    amount: 258_077,
    decimals: 6,
  },
  cUSDTv3: {
    address: '0x995E394b8B2437aC8Ce61Ee0bC610D617962B214',
    assetL1: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    assetL2: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    amount: 10_242,
    decimals: 6,
  },
};

const recipient = '0xDcB34b56842F853A69E86De5A0c22c49d97C130C';

let balancesBefore: Record<string, BigNumber> = {};

async function getErc20FromAddress(dm: DeploymentManager, address: string, ): Promise<Contract> {
  return new Contract(address, ['function balanceOf(address) view returns (uint256)'], await dm.getSigner());
}

export default migration('1776160391_withdraw_reserves', {
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
      opL1CrossDomainMessenger
    } = await govDeploymentManager.getContracts();

    const withdrawUSDCCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [l2Timelock.address, exp(withdrawConfig.cUSDCv3.amount, withdrawConfig.cUSDCv3.decimals)]
    );

    const approveUSDCCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [l2StandardBridge.address, exp(withdrawConfig.cUSDCv3.amount, withdrawConfig.cUSDCv3.decimals)]
    );

    const bridgeERC20ToUSDCCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'address', 'uint256', 'uint32', 'bytes'],
      [
        withdrawConfig.cUSDCv3.assetL2, // _localToken
        withdrawConfig.cUSDCv3.assetL1, // _remoteToken
        recipient, // _to
        exp(withdrawConfig.cUSDCv3.amount, withdrawConfig.cUSDCv3.decimals), // _amount
        200000, // _minGasLimit
        '0x', // _data
      ]
    );

    const withdrawUSDTCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [l2Timelock.address, exp(withdrawConfig.cUSDTv3.amount, withdrawConfig.cUSDTv3.decimals)]
    );

    const approveUSDTCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [l2StandardBridge.address, exp(withdrawConfig.cUSDTv3.amount, withdrawConfig.cUSDTv3.decimals)]
    );

    const bridgeERC20ToUSDTCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'address', 'uint256', 'uint32', 'bytes'],
      [
        withdrawConfig.cUSDTv3.assetL2, // _localToken
        withdrawConfig.cUSDTv3.assetL1, // _remoteToken
        recipient, // _to
        exp(withdrawConfig.cUSDTv3.amount, withdrawConfig.cUSDTv3.decimals), // _amount
        200000, // _minGasLimit
        '0x', // _data
      ]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          withdrawConfig.cUSDCv3.address,
          withdrawConfig.cUSDCv3.assetL2,
          l2StandardBridge.address,
          withdrawConfig.cUSDTv3.address,
          withdrawConfig.cUSDTv3.assetL2,
          l2StandardBridge.address,
        ],
        [
          0, 0, 0,
          0, 0, 0,
        ],
        [
          'withdrawReserves(address,uint256)',
          'approve(address,uint256)',
          'bridgeERC20To(address,address,address,uint256,uint32,bytes)',
          'withdrawReserves(address,uint256)',
          'approve(address,uint256)',
          'bridgeERC20To(address,address,address,uint256,uint32,bytes)'
        ],
        [
          withdrawUSDCCalldata,
          approveUSDCCalldata,
          bridgeERC20ToUSDCCalldata,
          withdrawUSDTCalldata,
          approveUSDTCalldata,
          bridgeERC20ToUSDTCalldata,
        ]
      ]
    );

    const mainnetActions = [
      // Send the proposal to the L2 bridge
      {
        contract: opL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 2_500_000],
      }
    ];

    const USDC = await getErc20FromAddress(govDeploymentManager, withdrawConfig.cUSDCv3.assetL1);
    const USDT = await getErc20FromAddress(govDeploymentManager, withdrawConfig.cUSDTv3.assetL1);

    balancesBefore = {
      USDC: await USDC.balanceOf(recipient),
      USDT: await USDT.balanceOf(recipient),
    };

    const description = `# Withdraw reserves from cUSDCv3 and cUSDTv3 markets on Optimism 

## Proposal summary

Recipient address: ${recipient}

## Proposal actions

The first proposal action sends a message to the Optimism bridgeReceiver to execute a proposal on L2, which will:
- Withdraw 258,077 USDC from the cUSDCv3 market on Optimism
- Withdraw 10,242 USDT from the cUSDTv3 market on Optimism
- Send the withdrawn USDC and USDT to the L2 timelock, which will then send the withdrawn tokens from L2 to L1 using the native Optimism bridge.
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
    const USDC = await getErc20FromAddress(govDeploymentManager, withdrawConfig.cUSDCv3.assetL1);
    const USDT = await getErc20FromAddress(govDeploymentManager, withdrawConfig.cUSDTv3.assetL1);

    const balancesAfter = {
      USDC: await USDC.balanceOf(recipient),
      USDT: await USDT.balanceOf(recipient),
    };

    expect(balancesAfter.USDC.sub(balancesBefore.USDC)).to.equal(exp(withdrawConfig.cUSDCv3.amount, withdrawConfig.cUSDCv3.decimals));
    expect(balancesAfter.USDT.sub(balancesBefore.USDT)).to.equal(exp(withdrawConfig.cUSDTv3.amount, withdrawConfig.cUSDTv3.decimals));
  },
});
