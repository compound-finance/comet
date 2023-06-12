import { DeploymentManager } from '../../plugins/deployment_manager';
import { setNextBaseFeeToZero, setNextBlockTimestamp } from './hreUtils';
import { constants, ethers } from 'ethers';
import { Log } from '@ethersproject/abstract-provider';
import { OpenBridgedProposal } from '../context/Gov';

export default async function relayLineaMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  startingBlockNumber: number
) {
  const zkEvm2 = await governanceDeploymentManager.getContractOrThrow('zkEvm2');
  const bridgeReceiver = await bridgeDeploymentManager.getContractOrThrow('bridgeReceiver');
  const l2MessageService = await bridgeDeploymentManager.getContractOrThrow('l2MessageService');
  const l2TokenBridge = await bridgeDeploymentManager.getContractOrThrow('l2TokenBridge');

  const openBridgedProposals: OpenBridgedProposal[] = [];

  // Grab all events on the L1CrossDomainMessenger contract since the `startingBlockNumber`
  const filter = zkEvm2.filters.MessageSent();
  const messageSentEvents: Log[] = await governanceDeploymentManager.hre.ethers.provider.getLogs({
    fromBlock: startingBlockNumber,
    toBlock: 'latest',
    address: zkEvm2.address,
    topics: filter.topics!
  });

  for (let messageSentEvent of messageSentEvents) {
    const {
      args: { target, sender, message, messageNonce, gasLimit }
    } = zkEvm2.interface.parseLog(messageSentEvent);

    await setNextBaseFeeToZero(bridgeDeploymentManager);
    const relayMessageTxn = await (
      await l2MessageService.claimMessage(
        sender,
        target,
        0,
        0,
        constants.AddressZero,
        message,
        messageNonce,
        {
          gasPrice: 0,
          gasLimit
        }
      )
    ).wait();

    // Try to decode the SentMessage data to determine what type of cross-chain activity this is. So far,
    // there are two types:
    // 1. Bridging ERC20 token
    // 2. Cross-chain message passing
    if (target === l2TokenBridge.address) {
      // Bridging ERC20 token
      const messageWithoutPrefix = message.slice(2); // strip out the 0x prefix
      const messageWithoutSigHash = '0x' + messageWithoutPrefix.slice(8);

      // Bridging ERC20 token
      const { l1Token, amount, to, _data } = ethers.utils.defaultAbiCoder.decode(
        ['address l1Token', 'address to', 'uint256 amount', 'bytes data'],
        messageWithoutSigHash
      );

      console.log(
        `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Bridged over ${amount} of ${l1Token} to user ${to}`
      );
    } else if (target === bridgeReceiver.address) {
      // Cross-chain message passing
      const proposalCreatedEvent = relayMessageTxn.events.find(
        event => event.address === bridgeReceiver.address
      );
      const {
        args: { id, eta }
      } = bridgeReceiver.interface.parseLog(proposalCreatedEvent);

      // Add the proposal to the list of open bridged proposals to be executed after all the messages have been relayed
      openBridgedProposals.push({ id, eta });
    } else {
      throw new Error(
        `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Unrecognized target for cross-chain message`
      );
    }
  }

  // Execute open bridged proposals now that all messages have been bridged
  for (let proposal of openBridgedProposals) {
    const { eta, id } = proposal;
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
