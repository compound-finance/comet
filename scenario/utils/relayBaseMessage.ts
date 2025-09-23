import { DeploymentManager } from '../../plugins/deployment_manager';
import { impersonateAddress } from '../../plugins/scenario/utils';
import { setNextBaseFeeToZero, setNextBlockTimestamp } from './hreUtils';
import { BigNumber, ethers } from 'ethers';
import { Log } from '@ethersproject/abstract-provider';
import { OpenBridgedProposal } from '../context/Gov';
import { applyL1ToL2Alias, isTenderlyLog } from './index';
/*
The Base relayer applies an offset to the message sender.

applyL1ToL2Alias mimics the AddressAliasHelper.applyL1ToL2Alias fn that converts
an L1 address to its offset, L2 equivalent.

https://sepolia.basescan.org/address/0x4200000000000000000000000000000000000007#code
*/

export default async function relayBaseMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  startingBlockNumber: number,
  tenderlyLogs?: any[]
) {
  const baseL1CrossDomainMessenger = await governanceDeploymentManager.getContractOrThrow('baseL1CrossDomainMessenger');
  const bridgeReceiver = await bridgeDeploymentManager.getContractOrThrow('bridgeReceiver');
  const l2CrossDomainMessenger = await bridgeDeploymentManager.getContractOrThrow('l2CrossDomainMessenger');
  const l2StandardBridge = await bridgeDeploymentManager.getContractOrThrow('l2StandardBridge');
  const l2USDSBridge = await bridgeDeploymentManager.contract('l2USDSBridge');

  const openBridgedProposals: OpenBridgedProposal[] = [];

  // Grab all events on the L1CrossDomainMessenger contract since the `startingBlockNumber`
  const filter = baseL1CrossDomainMessenger.filters.SentMessage();
  let sentMessageEvents: Log[] = [];

  if (tenderlyLogs) {
    const sentMessageTopic = baseL1CrossDomainMessenger.interface.getEventTopic('SentMessage');

    const tenderlySentMessageEvents = tenderlyLogs.filter(log =>
      log.raw?.topics?.[0] === sentMessageTopic &&
      log.raw?.address?.toLowerCase() === baseL1CrossDomainMessenger.address.toLowerCase()
    );

    const realSentMessageEvents = await governanceDeploymentManager.hre.ethers.provider.getLogs({
      fromBlock: startingBlockNumber,
      toBlock: 'latest',
      address: baseL1CrossDomainMessenger.address,
      topics: filter.topics!,
    });

    sentMessageEvents = [...realSentMessageEvents, ...tenderlySentMessageEvents];
  } else {
    sentMessageEvents = await governanceDeploymentManager.hre.ethers.provider.getLogs({
      fromBlock: startingBlockNumber,
      toBlock: 'latest',
      address: baseL1CrossDomainMessenger.address,
      topics: filter.topics!,
    });
  }

  for (let sentMessageEvent of sentMessageEvents) {
    let parsedLog;
    
    if (isTenderlyLog(sentMessageEvent)) {
      parsedLog = baseL1CrossDomainMessenger.interface.parseLog({
        topics: sentMessageEvent.raw.topics,
        data: sentMessageEvent.raw.data,
      });
    } else {
      parsedLog = baseL1CrossDomainMessenger.interface.parseLog(sentMessageEvent);
    }

    const {
      args: { target, sender, message, messageNonce, gasLimit },
    } = parsedLog;

    const aliasedSigner = await impersonateAddress(
      bridgeDeploymentManager,
      applyL1ToL2Alias(baseL1CrossDomainMessenger.address)
    );

    let relayMessageTxn: { events: any[] };
    await setNextBaseFeeToZero(bridgeDeploymentManager);
    
    if (tenderlyLogs) {
      const callData = l2CrossDomainMessenger.interface.encodeFunctionData(
        'relayMessage',
        [messageNonce, sender, target, 0, 0, message]
      );
      bridgeDeploymentManager.stashRelayMessage(
        l2CrossDomainMessenger.address,
        callData,
        aliasedSigner.address
      );
    }

    relayMessageTxn = await (
      await l2CrossDomainMessenger
        .connect(aliasedSigner)
        .relayMessage(messageNonce, sender, target, 0, 0, message, {
          gasPrice: 0,
          gasLimit,
        })
    ).wait();

    // Try to decode the SentMessage data to determine what type of cross-chain activity this is. So far,
    // there are two types:
    // 1. Bridging ERC20 token or ETH
    // 2. Cross-chain message passing
    if (target === l2StandardBridge.address || (l2USDSBridge && target === l2USDSBridge.address)) {
      // Bridging ERC20 token
      const messageWithoutPrefix = message.slice(2); // strip out the 0x prefix
      const messageWithoutSigHash = '0x' + messageWithoutPrefix.slice(8);
      try {
        // 1a. Bridging ERC20 token
        const { _l2Token, l1Token, _from, to, amount, _data } =
          ethers.utils.defaultAbiCoder.decode(
            ['address l2Token', 'address l1Token', 'address from', 'address to', 'uint256 amount', 'bytes data'],
            messageWithoutSigHash
          );

        console.log(
          `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Bridged over ${amount} of ${l1Token} to user ${to}`
        );
      } catch (e) {
        // 1a. Bridging ETH
        const { _from, to, amount, _data } = ethers.utils.defaultAbiCoder.decode(
          ['address from', 'address to', 'uint256 amount', 'bytes data'],
          messageWithoutSigHash
        );

        const oldBalance = await bridgeDeploymentManager.hre.ethers.provider.getBalance(to);
        const newBalance = oldBalance.add(BigNumber.from(amount));
        // This is our best attempt to mimic the deposit transaction type (not supported in Hardhat) that Optimism uses to deposit ETH to an L2 address
        await bridgeDeploymentManager.hre.ethers.provider.send('hardhat_setBalance', [
          to,
          ethers.utils.hexStripZeros(newBalance.toHexString()),
        ]);

        console.log(
          `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Bridged over ${amount} of ETH to user ${to}`
        );
      }
    } else if (target === bridgeReceiver.address) {
      // Cross-chain message passing
      if (!tenderlyLogs && relayMessageTxn) {
        const proposalCreatedEvent = relayMessageTxn.events.find(
          (event) => event.address === bridgeReceiver.address
        );
        const {
          args: { id, eta },
        } = bridgeReceiver.interface.parseLog(proposalCreatedEvent);

        // Add the proposal to the list of open bridged proposals to be executed after all the messages have been relayed
        openBridgedProposals.push({ id, eta });
      }
    } else {
      throw new Error(
        `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Unrecognized target for cross-chain message`
      );
    }
  }

  // Handle proposal creation for tenderly
  if (tenderlyLogs) {
    // We need to check for ProposalCreated events since we don't get them in the loop above
    const proposalFilter = bridgeReceiver.filters.ProposalCreated();
    const proposalEvents = await bridgeDeploymentManager.hre.ethers.provider.getLogs({
      fromBlock: 'latest',
      toBlock: 'latest',
      address: bridgeReceiver.address,
      topics: proposalFilter.topics
    });

    for (let event of proposalEvents) {
      const {
        args: { id, eta },
      } = bridgeReceiver.interface.parseLog(event);
      openBridgedProposals.push({ id, eta });
    }
  }

  // Execute open bridged proposals now that all messages have been bridged
  for (let proposal of openBridgedProposals) {
    const { eta, id } = proposal;
    // Fast forward l2 time
    await setNextBlockTimestamp(bridgeDeploymentManager, eta.toNumber() + 1);

    // Execute queued proposal
    await setNextBaseFeeToZero(bridgeDeploymentManager);
    if (tenderlyLogs) {
      const callData = bridgeReceiver.interface.encodeFunctionData(
        'executeProposal',
        [id]
      );
      const signer = await bridgeDeploymentManager.getSigner();
      bridgeDeploymentManager.stashRelayMessage(
        bridgeReceiver.address,
        callData,
        await signer.getAddress()
      );
    } else {
      await bridgeReceiver.executeProposal(id, { gasPrice: 0 });
    }
    console.log(
      `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Executed bridged proposal ${id}`
    );
  }

  return openBridgedProposals;
}