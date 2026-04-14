import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { utils, Contract, BigNumber } from 'ethers';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';

const withdrawConfig = {
  cUSDCv3: {
    address: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf',
    assetL1: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    assetL2: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    amount: 43_556,
    decimals: 6,
  },
  cUSDCev3: {
    address: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA',
    assetL1: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    assetL2: '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8',
    amount: 257_235,
    decimals: 6,
  },
  cWETHv3: {
    address: '0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486',
    assetL1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    assetL2: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    amount: 32.03,
    decimals: 18,
  },
};

const recipient = '0x9825413dd3875E01B34451A7A7e066b2225a234E';

const USDCE_GATEWAY = '0x096760F208390250649E3e8763348E783AEF5562';
const WETH_GATEWAY = '0x6c411aD3E74De3E7Bd422b94A27770f5B86C623B';

let balancesBefore: Record<string, BigNumber> = {};

async function getErc20FromAddress(dm: DeploymentManager, address: string, ): Promise<Contract> {
  return new Contract(address, ['function balanceOf(address) view returns (uint256)'], await dm.getSigner());
}

export default migration('1775822198_withdraw_reserves', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) {
    const trace = deploymentManager.tracer();

    const {
      bridgeReceiver,
      timelock: l2Timelock,
      CCTPTokenMessenger
    } = await deploymentManager.getContracts();

    const {
      arbitrumInbox,
      timelock,
      governor
    } = await govDeploymentManager.getContracts();

    const withdrawUSDCCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [l2Timelock.address, exp(withdrawConfig.cUSDCv3.amount, withdrawConfig.cUSDCv3.decimals)]
    );

    const withdrawUSDTCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [l2Timelock.address, exp(withdrawConfig.cUSDCev3.amount, withdrawConfig.cUSDCev3.decimals)]
    );

    const withdrawETHCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [l2Timelock.address, exp(withdrawConfig.cWETHv3.amount, withdrawConfig.cWETHv3.decimals)]
    );

    const approveUSDCCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [CCTPTokenMessenger.address, exp(withdrawConfig.cUSDCv3.amount, withdrawConfig.cUSDCv3.decimals)]
    );

    const depositForBurnUSDCCalldata = utils.defaultAbiCoder.encode(
      ['uint256', 'uint32', 'bytes32', 'address', 'bytes32', 'uint256', 'uint32'],
      [
        exp(withdrawConfig.cUSDCv3.amount, 6), // amount
        0, // destinationDomain (Ethereum Mainnet)
        utils.hexZeroPad(recipient, 32), // mintRecipient
        withdrawConfig.cUSDCv3.assetL2, // burnToken
        utils.hexZeroPad('0x', 32), // destinationCaller
        exp(10, 6), // maxFee
        1000 // minFinalityThreshold
      ]
    );

    const approveUSDCECalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [USDCE_GATEWAY, exp(withdrawConfig.cUSDCev3.amount, withdrawConfig.cUSDCev3.decimals)]
    );

    const outboundTransferUSDCECalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint256', 'bytes'],
      [
        withdrawConfig.cUSDCev3.assetL1, // l1Token
        recipient, // to
        exp(withdrawConfig.cUSDCev3.amount, withdrawConfig.cUSDCev3.decimals), // amount
        '0x' // data
      ]
    );

    const approveWETHCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [WETH_GATEWAY, exp(withdrawConfig.cWETHv3.amount, withdrawConfig.cWETHv3.decimals)]
    );

    const outboundTransferWETHCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint256', 'bytes'],
      [
        withdrawConfig.cWETHv3.assetL1, // l1Token
        recipient, // to
        exp(withdrawConfig.cWETHv3.amount, withdrawConfig.cWETHv3.decimals), // amount
        '0x' // data
      ]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          withdrawConfig.cUSDCv3.address,
          withdrawConfig.cUSDCev3.address,
          withdrawConfig.cWETHv3.address,
          withdrawConfig.cUSDCv3.assetL2,
          CCTPTokenMessenger.address,
          withdrawConfig.cUSDCev3.assetL2,
          USDCE_GATEWAY,
          withdrawConfig.cWETHv3.assetL2,
          WETH_GATEWAY
        ],
        [
          0, 0, 0,
          0, 0,
          0, 0,
          0, 0
        ],
        [
          'withdrawReserves(address,uint256)', 'withdrawReserves(address,uint256)', 'withdrawReserves(address,uint256)',
          'approve(address,uint256)', 'depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)',
          'approve(address,uint256)', 'outboundTransfer(address,address,uint256,bytes)',
          'approve(address,uint256)', 'outboundTransfer(address,address,uint256,bytes)',
        ],
        [
          withdrawUSDCCalldata,
          withdrawUSDTCalldata,
          withdrawETHCalldata,
          approveUSDCCalldata,
          depositForBurnUSDCCalldata,
          approveUSDCECalldata,
          outboundTransferUSDCECalldata,
          approveWETHCalldata,
          outboundTransferWETHCalldata
        ]
      ]
    );

    const createRetryableTicketGasParams = await estimateL2Transaction(
      {
        from: applyL1ToL2Alias(timelock.address),
        to: bridgeReceiver.address,
        data: l2ProposalData
      },
      deploymentManager
    );
    const refundAddress = l2Timelock.address;

    const mainnetActions = [
      // 1. Sends the proposal to the L2
      {
        contract: arbitrumInbox,
        signature: 'createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
        args: [
          bridgeReceiver.address,                           // address to,
          0,                                                // uint256 l2CallValue,
          createRetryableTicketGasParams.maxSubmissionCost, // uint256 maxSubmissionCost,
          refundAddress,                                    // address excessFeeRefundAddress,
          refundAddress,                                    // address callValueRefundAddress,
          createRetryableTicketGasParams.gasLimit,          // uint256 gasLimit,
          createRetryableTicketGasParams.maxFeePerGas,      // uint256 maxFeePerGas,
          l2ProposalData,                                   // bytes calldata data
        ],
        value: createRetryableTicketGasParams.deposit
      },
    ];

    const USDC = await getErc20FromAddress(govDeploymentManager, withdrawConfig.cUSDCv3.assetL1);
    
    balancesBefore = {
      USDC: await USDC.balanceOf(recipient),
      ETH: BigNumber.from(await govDeploymentManager.hre.ethers.provider.getBalance(recipient)),
    };

    const description = `# Withdraw reserves from cUSDCv3, cUSDCev3, and cWETHv3 markets on Arbitrum 

## Proposal summary

Recipient address: ${recipient}

## Proposal actions

The first proposal action sends a message to the Arbitrum bridgeReceiver to execute a proposal on L2, which will:
- Withdraw 43,556 USDC from the cUSDCv3 market on Arbitrum
- Withdraw 257,235 USDC from the cUSDCev3 market on Arbitrum
- Withdraw 32.03 ETH from the cWETHv3 market on Arbitrum
- Send the withdrawn assets to the L2 timelock, which will then:
  - Call the CCTP Token Messenger to transfer the withdrawn USDC from L2 to L1
  - Call the Arbitrum L1 gateways to transfer the withdrawn USDCe and WETH from L2 to L1.
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

    const balancesAfter = {
      USDC: await USDC.balanceOf(recipient),
      ETH: BigNumber.from(await govDeploymentManager.hre.ethers.provider.getBalance(recipient)),
    };

    expect(balancesAfter.USDC.sub(balancesBefore.USDC)).to.equal(exp(withdrawConfig.cUSDCv3.amount, withdrawConfig.cUSDCv3.decimals) + exp(withdrawConfig.cUSDCev3.amount, withdrawConfig.cUSDCev3.decimals));
    expect(balancesAfter.ETH.sub(balancesBefore.ETH)).to.equal(exp(withdrawConfig.cWETHv3.amount, withdrawConfig.cWETHv3.decimals));
  },
});
