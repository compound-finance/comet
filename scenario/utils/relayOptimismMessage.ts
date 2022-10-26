import { DeploymentManager } from '../../plugins/deployment_manager';
import { impersonateAddress } from '../../plugins/scenario/utils';
import { setNextBaseFeeToZero, setNextBlockTimestamp } from './hreUtils';
import { Event } from 'ethers';

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
) {
  const EVENT_LISTENER_TIMEOUT = 60000;

  const optimismL1CrossDomainMessenger = await governanceDeploymentManager.getContractOrThrow('optimismL1CrossDomainMessenger');
  const bridgeReceiver = await bridgeDeploymentManager.getContractOrThrow('bridgeReceiver');
  const l2CrossDomainMessenger = await bridgeDeploymentManager.getContractOrThrow('l2CrossDomainMessenger');

  const { id: functionIdentifier, Interface } = governanceDeploymentManager.hre.ethers.utils;

  // listen on events on the OptimismL1CrossDomainMessenger
  const sentMessageListenerPromise = new Promise((resolve, reject) => {
    const filter = {
      address: optimismL1CrossDomainMessenger.address,
      topics: [functionIdentifier('SentMessage(address,address,bytes,uint256,uint256)')]
    };

    governanceDeploymentManager.hre.ethers.provider.on(filter, (log) => {
      resolve(log);
    });

    setTimeout(() => {
      reject(new Error('OptimismL1CrossDomainMessenger.SentMessage event listener timed out'));
    }, EVENT_LISTENER_TIMEOUT);
  });

  const sentMessageEvent = await sentMessageListenerPromise as Event;

  const eventInterface = new Interface([
    'event SentMessage(address indexed target, address sender, bytes message, uint256 messageNonce, uint256 gasLimit)'
  ]);

  const events = eventInterface.parseLog(sentMessageEvent);
  const { args: { target, sender, message, messageNonce } } = events;

  const aliasedSigner = await impersonateAddress(
    bridgeDeploymentManager,
    applyL1ToL2Alias(optimismL1CrossDomainMessenger.address)
  );

  await setNextBaseFeeToZero(bridgeDeploymentManager);
  const relayMessageTxn = await (
    await l2CrossDomainMessenger.connect(aliasedSigner).relayMessage(
      target,
      sender,
      message,
      messageNonce,
      { gasPrice: 0 }
    )
  ).wait();

  const proposalCreatedEvent = relayMessageTxn.events.find(event => event.address === bridgeReceiver.address);
  const { args: { id, eta } } = bridgeReceiver.interface.parseLog(proposalCreatedEvent);

  // fast forward l2 time
  await setNextBlockTimestamp(bridgeDeploymentManager, eta.toNumber() + 1);

  // execute queued proposal
  await setNextBaseFeeToZero(bridgeDeploymentManager);
  await bridgeReceiver.executeProposal(id, { gasPrice: 0 });
}