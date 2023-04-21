import { DeploymentManager } from '../../plugins/deployment_manager';
import { impersonateAddress } from '../../plugins/scenario/utils';
import { setNextBaseFeeToZero, setNextBlockTimestamp } from './hreUtils';
import { utils, BigNumber } from 'ethers';
import { Log } from '@ethersproject/abstract-provider';

export default async function relayArbitrumMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  startingBlockNumber: number
) {
  // L1 contracts
  const inbox = await governanceDeploymentManager.getContractOrThrow('arbitrumInbox'); // Inbox -> Bridge
  const bridge = await governanceDeploymentManager.getContractOrThrow('arbitrumBridge');

  // L2 contracts
  const bridgeReceiver = await bridgeDeploymentManager.getContractOrThrow('bridgeReceiver');

  const inboxMessageDeliveredEvents: Log[] = await governanceDeploymentManager.hre.ethers.provider.getLogs({
    fromBlock: startingBlockNumber,
    toBlock: 'latest',
    address: inbox.address,
    topics: [utils.id('InboxMessageDelivered(uint256,bytes)')]
  });

  const dataAndTargets = inboxMessageDeliveredEvents.map(({ data, topics }) => {
    const header = '0x';
    const headerLength = header.length;
    const wordLength = 2 * 32;
    const innnerData = header + data.slice(headerLength + (11 * wordLength));
    const toValue = data.slice(headerLength + (2 * wordLength), headerLength + (3 * wordLength));
    const toAddress = BigNumber.from(`0x${toValue}`).toHexString();
    const messageNum = topics[1];
    return {
      data: innnerData,
      toAddress,
      messageNum
    };
  });

  const messageDeliveredEvents: Log[] = await governanceDeploymentManager.hre.ethers.provider.getLogs({
    fromBlock: startingBlockNumber,
    toBlock: 'latest',
    address: bridge.address,
    topics: [utils.id('MessageDelivered(uint256,bytes32,address,uint8,address,bytes32,uint256,uint64)')]
  });

  const senders = messageDeliveredEvents.map(({ data, topics }) => {
    const decodedData = utils.defaultAbiCoder.decode(
      [
        'address inbox',
        'uint8 kind',
        'address sender',
        'bytes32 messageDataHash',
        'uint256 baseFeeL1',
        'uint64 timestamp'
      ],
      data
    );
    const { sender } = decodedData;
    const messageNum = topics[1];
    return {
      sender,
      messageNum
    };
  });

  const bridgedMessages = dataAndTargets.map((dataAndTarget, i) => {
    if (dataAndTarget.messageNum !== senders[i].messageNum) {
      throw new Error(`Mismatched message numbers in Arbitrum bridged message to ${dataAndTarget.toAddress}`);
    }
    return {
      ...dataAndTarget,
      ...senders[i]
    };
  });

  for (let bridgedMessage of bridgedMessages) {
    const { sender, data, toAddress } = bridgedMessage;
    const arbitrumSigner = await impersonateAddress(
      bridgeDeploymentManager,
      sender
    );
    const transactionRequest = await arbitrumSigner.populateTransaction({
      to: toAddress,
      from: sender,
      data,
      gasPrice: 0
    });

    await setNextBaseFeeToZero(bridgeDeploymentManager);

    const tx = await (
      await arbitrumSigner.sendTransaction(transactionRequest)
    ).wait();

    const proposalCreatedLog = tx.logs.find(
      event => event.address === bridgeReceiver.address
    );
    if (proposalCreatedLog) {
      const {
        args: { id, eta }
      } = bridgeReceiver.interface.parseLog(proposalCreatedLog);

      // fast forward l2 time
      await setNextBlockTimestamp(bridgeDeploymentManager, eta.toNumber() + 1);

      // execute queued proposal
      await setNextBaseFeeToZero(bridgeDeploymentManager);
      await bridgeReceiver.executeProposal(id, { gasPrice: 0 });
    }
  }
}
