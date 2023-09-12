import { DeploymentManager } from '../../plugins/deployment_manager';
import { setNextBaseFeeToZero, setNextBlockTimestamp } from './hreUtils';
import { Log } from '@ethersproject/abstract-provider';
import { impersonateAddress } from '../../plugins/scenario/utils';

/*
The Scroll relayer applies an offset to the message sender.

applyL1ToL2Alias mimics the AddressAliasHelper.applyL1ToL2Alias fn that converts
an L1 address to its offset, L2 equivalent.
*/
function applyL1ToL2Alias(address: string) {
    const offset = BigInt('0x1111000000000000000000000000000000001111');
    return `0x${(BigInt(address) + offset).toString(16)}`;
  }

export default async function relayScrollMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  startingBlockNumber: number
) {
  const scrollMessenger = await governanceDeploymentManager.getContractOrThrow(
    'scrollMessenger'
  );
  const bridgeReceiver = await bridgeDeploymentManager.getContractOrThrow('bridgeReceiver');
  const l2Messenger = await bridgeDeploymentManager.getContractOrThrow('l2Messenger');

  // Grab all events on the L1CrossDomainMessenger contract since the `startingBlockNumber`
  const filter = scrollMessenger.filters.SentMessage();
  const messageSentEvents: Log[] = await governanceDeploymentManager.hre.ethers.provider.getLogs({
    fromBlock: startingBlockNumber,
    toBlock: 'latest',
    address: scrollMessenger.address,
    topics: filter.topics!
  });
  for (let messageSentEvent of messageSentEvents) {
    const {
      args: { sender, target, value, messageNonce, gasLimit, message }
    } = scrollMessenger.interface.parseLog(messageSentEvent);

    await setNextBaseFeeToZero(bridgeDeploymentManager);

    const aliasAccount = await impersonateAddress(
        bridgeDeploymentManager,
        applyL1ToL2Alias(scrollMessenger.address)
    );

    const relayMessageTxn = await (
      await l2Messenger.connect(aliasAccount).relayMessage(
        sender,
        target,
        value,
        messageNonce,
        message,
        { gasPrice: 0, gasLimit }
      )
    ).wait();

        const proposalCreatedEvent = relayMessageTxn.events.find(
            event => event.address === bridgeReceiver.address
        );
        const {
            args: { id, eta }
        } = bridgeReceiver.interface.parseLog(proposalCreatedEvent);

        // Execute open bridged proposal
        // Fast forward l2 time
        await setNextBlockTimestamp(bridgeDeploymentManager, eta.toNumber() + 1);

        // Execute queued proposal
        await setNextBaseFeeToZero(bridgeDeploymentManager);
        await bridgeReceiver.executeProposal(id, { gasPrice: 0 });
        console.log(
            `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Executed bridged proposal ${id}`
        );
    }
}
