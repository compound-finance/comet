import { DeploymentManager } from '../../plugins/deployment_manager';
import { impersonateAddress } from '../../plugins/scenario/utils';
import { setNextBaseFeeToZero, setNextBlockTimestamp } from './hreUtils';
import { BigNumber, ethers } from 'ethers';
import { Log } from '@ethersproject/abstract-provider';

/*
The Optimism relayer applies an offset to the message sender.

applyL1ToL2Alias mimics the AddressAliasHelper.applyL1ToL2Alias fn that converts
an L1 address to its offset, L2 equivalent.

https://optimistic.etherscan.io/address/0x4200000000000000000000000000000000000007#code
*/
function applyL1ToL2Alias(address: string) {
  const offset = BigInt('0x1111000000000000000000000000000000001111');
  return `0x${(BigInt(address) + offset).toString(16)}`;
}

export default async function relayOptimismMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  startingBlockNumber: number
) {
  const optimismL1CrossDomainMessenger = await governanceDeploymentManager.getContractOrThrow('optimismL1CrossDomainMessenger');
  const bridgeReceiver = await bridgeDeploymentManager.getContractOrThrow('bridgeReceiver');
  const l2CrossDomainMessenger = await bridgeDeploymentManager.getContractOrThrow('l2CrossDomainMessenger');
  const l2StandardBridge = await bridgeDeploymentManager.getContractOrThrow('l2StandardBridge');

  // Grab all events on the L1CrossDomainMessenger contract since the `startingBlockNumber`
  const filter = optimismL1CrossDomainMessenger.filters.SentMessage();
  const sentMessageEvents: Log[] = await governanceDeploymentManager.hre.ethers.provider.getLogs({
    fromBlock: startingBlockNumber,
    toBlock: 'latest',
    address: optimismL1CrossDomainMessenger.address,
    topics: filter.topics!
  });

  for (let sentMessageEvent of sentMessageEvents) {
    const { args: { target, sender, message, messageNonce, gasLimit } } = optimismL1CrossDomainMessenger.interface.parseLog(sentMessageEvent);
    console.log('message nonce ', messageNonce)
    const aliasedSigner = await impersonateAddress(
      bridgeDeploymentManager,
      applyL1ToL2Alias(optimismL1CrossDomainMessenger.address)
    );

    await setNextBaseFeeToZero(bridgeDeploymentManager);
    console.log('estimate gas later ', await bridgeDeploymentManager.hre.ethers.provider.estimateGas(await l2CrossDomainMessenger.connect(aliasedSigner).populateTransaction.relayMessage(
      BigNumber.from('0x0001000000000000000000000000000000000000000000000000000000000007'), // message nonce
      sender,
      target,
      0,
      0,
      message,
      { gasPrice: 0, gasLimit }
    )));

    const relayMessageTxn = await (
      await l2CrossDomainMessenger.connect(aliasedSigner).relayMessage(
        BigNumber.from('0x0001000000000000000000000000000000000000000000000000000000000007'), // message nonce
        sender,
        target,
        0,
        0,
        message,
        { gasPrice: 0, gasLimit }
      )
    ).wait();

    // Try to decode the SentMessage data to determine what type of cross-chain activity this is. So far,
    // there are two types:
    // 1. Bridging ERC20 token
    // 2. Cross-chain message passing
    if (target === l2StandardBridge.address) {
      // Bridging ERC20 token
      const messageWithoutPrefix = message.slice(2); // strip out the 0x prefix
      const messageWithoutSigHash = '0x' + messageWithoutPrefix.slice(8);
      const { l1Token, _l2Token, _from, to, amount, _data } = ethers.utils.defaultAbiCoder.decode(
        ['address l1Token', 'address l2Token', 'address from', 'address to', 'uint256 amount', 'bytes data'],
        messageWithoutSigHash
      );

      console.log(
        `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Bridged over ${amount} of ${l1Token} to user ${to}`
      );
    } else if (target === bridgeReceiver.address) {
      // Cross-chain message passing
      console.log('gas used real ', relayMessageTxn)
      const proposalCreatedEvent = relayMessageTxn.events.find(event => event.address === bridgeReceiver.address);
      const { args: { id, eta } } = bridgeReceiver.interface.parseLog(proposalCreatedEvent);

      // fast forward l2 time
      await setNextBlockTimestamp(bridgeDeploymentManager, eta.toNumber() + 1);

      // execute queued proposal
      await setNextBaseFeeToZero(bridgeDeploymentManager);
      await bridgeReceiver.executeProposal(id, { gasPrice: 0 });
      console.log(
        `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Executed bridged proposal ${id}`
      );
    } else {
      throw new Error(`[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Unrecognized target for cross-chain message`);
    }
  }
}