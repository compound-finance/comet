import { BigNumber, Contract, utils } from 'ethers';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';

// https://github.com/OffchainLabs/arbitrum/blob/master/packages/arb-bridge-eth/contracts/libraries/AddressAliasHelper.sol
export function applyL1ToL2Alias(l1Address: string) {
  const offset = BigNumber.from('0x1111000000000000000000000000000000001111');
  return BigNumber.from(l1Address).add(offset).toHexString();
}

const gatewayInterface = new utils.Interface(
  [
    'function counterpartGateway() view external returns (address)',
    'function finalizeInboundTransfer(address _token, address _from, address _to, uint256 _amount, bytes calldata _data) external payable'
  ]
);

// See https://developer.arbitrum.io/devs-how-tos/how-to-estimate-gas
export async function estimateL2Transaction(
  { from, to, data }: { to: string, from: string, data: string },
  l2DeploymentManager: DeploymentManager
) {
  // guess what the l1 gas price will be when the proposal is executed
  const l1GasPrice = (utils.parseUnits('200', 'gwei')).toNumber();
  // overestimating standard l2 gas by 5x (usually is 0.1 gwei)
  const l2GasPrice = (utils.parseUnits('0.5', 'gwei')).toNumber();

  const l2GasEstimateHex = await l2DeploymentManager.hre.network.provider.send(
    'eth_estimateGas',
    [{ from, to, data }]
  );
  const l2GasEstimate = BigNumber.from(l2GasEstimateHex);

  // Add overhead to cover retryable ticket creation etc
  const gasBuffer = 200_000;
  const l2GasLimit = BigNumber.from(gasBuffer).add(l2GasEstimate.mul(3).div(2));

  const bytesLength = utils.hexDataLength(data);
  // https://etherscan.io/address/0x5aed5f8a1e3607476f1f81c3d8fe126deb0afe94#code
  // calculateRetryableSubmissionFee
  const submissionCost = (1400 + 6 * bytesLength) * l1GasPrice;
  const submissionCostWithMargin = utils.parseUnits('10', 'gwei').add(submissionCost);

  const deposit = submissionCostWithMargin.add(l2GasLimit.mul(l2GasPrice));

  return {
    // gasLimit/maxGas
    gasLimit: l2GasLimit,
    // maxFeePerGas/gasPriceBid
    maxFeePerGas: l2GasPrice,
    // maxSubmissionCost/maxSubmissionFee
    maxSubmissionCost: submissionCostWithMargin,
    // deposit
    deposit
  };
}

export async function estimateTokenBridge(
  { to, from, token, amount }: {to: string, from: string, token: string, amount: bigint},
  l1DeploymentManager: DeploymentManager,
  l2DeploymentManager: DeploymentManager
) {
  const { arbitrumL1GatewayRouter } = await l1DeploymentManager.getContracts();

  const l1GatewayAddress = await arbitrumL1GatewayRouter.getGateway(token);
  const l1Gateway = new Contract(
    l1GatewayAddress,
    gatewayInterface,
    l1DeploymentManager.hre.ethers.provider
  );
  const l2GatewayAddress = await l1Gateway.counterpartGateway();

  const data = gatewayInterface.encodeFunctionData(
    'finalizeInboundTransfer',
    [
      token,  // address _token,
      from,   // address _from,
      to,     // address _to,
      amount, // uint256 _amount,
      utils.defaultAbiCoder.encode(
        ['bytes', 'bytes'], ['0x', '0x']
      ) // bytes calldata _data
    ]
  );

  return await estimateL2Transaction(
    {
      from: applyL1ToL2Alias(l1GatewayAddress),
      to: l2GatewayAddress,
      data
    },
    l2DeploymentManager
  );
}