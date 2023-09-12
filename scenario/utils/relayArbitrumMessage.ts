import { DeploymentManager } from '../../plugins/deployment_manager';
import { impersonateAddress } from '../../plugins/scenario/utils';
import { setNextBaseFeeToZero, setNextBlockTimestamp } from './hreUtils';
import { utils, BigNumber } from 'ethers';
import { Log } from '@ethersproject/abstract-provider';

export async function relayArbitrumMessage(
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

export async function relayCCTPMint(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  startingBlockNumber: number
){
  // CCTP relay
  // L1 contracts
  const L1MessageTransmitter = await governanceDeploymentManager.getContractOrThrow('CCTPMessageTransmitter');
  // Arbitrum TokenMinter which is L2 contracts
  const TokenMinter = 
    bridgeDeploymentManager.network === 'arbitrum' ? 
      await bridgeDeploymentManager.existing('TokenMinter', '0xE7Ed1fa7f45D05C508232aa32649D89b73b8bA48', 'arbitrum') : 
      await bridgeDeploymentManager.existing('TokenMinter', '0xE997d7d2F6E065a9A93Fa2175E878Fb9081F1f0A', 'arbitrum-goerli');


  const depositForBurnEvents: Log[] = await governanceDeploymentManager.hre.ethers.provider.getLogs({
    fromBlock: startingBlockNumber,
    toBlock: 'latest',
    address: L1MessageTransmitter.address,
    topics: [utils.id('MessageSent(bytes)')]
  });

  // Decode message body
  const burnEvents = depositForBurnEvents.map(({ data }) => {
    const dataBytes = utils.arrayify(data);
    // Since data is encodePacked, so can't simply decode via AbiCoder.decode
    const offset = 64;
    const length = {
      uint32: 4,
      uint64: 8,
      bytes32: 32,
      uint256: 32,
    };
    let start = offset;
    let end = start + length.uint32;
    // msgVersion, skip won't use
    start = end;
    end = start + length.uint32;
    // msgSourceDomain
    const msgSourceDomain = BigNumber.from(dataBytes.slice(start, end)).toNumber();

    start = end;
    end = start + length.uint32;
    // msgDestinationDomain, skip won't use

    start = end;
    end = start + length.uint64;
    // msgNonce, skip won't use

    start = end;
    end = start + length.bytes32;
    // msgSender, skip won't use

    start = end;
    end = start + length.bytes32;
    // msgRecipient, skip won't use

    start = end;
    end = start + length.bytes32;
    // msgDestination, skip won't use

    start = end;
    end = start + length.uint32;
    // rawMsgBody version, skip won't use

    start = end;
    end = start + length.bytes32;
    // rawMsgBody burnToken
    const burnToken = utils.hexlify(dataBytes.slice(start, end));

    start = end;
    end = start + length.bytes32;
    // rawMsgBody mintRecipient
    const mintRecipient = utils.getAddress(utils.hexlify(dataBytes.slice(start, end)).slice(-40));

    start = end;
    end = start + length.uint256;

    // rawMsgBody amount
    const amount = BigNumber.from(dataBytes.slice(start, end)).toNumber();

    start = end;
    end = start + length.bytes32;
    // rawMsgBody messageSender, skip won't use

    return {
      recipient: mintRecipient,
      amount: amount,
      sourceDomain: msgSourceDomain,
      burnToken: burnToken
    };
  });

  // Impersonate the Arbitrum TokenMinter and mint token to recipient
  const ImpersonateLocalTokenMessenger = 
  bridgeDeploymentManager.network === 'arbitrum' ? '0x19330d10d9cc8751218eaf51e8885d058642e08a' : 
    bridgeDeploymentManager.network === 'arbitrum-goerli' ? '0x12dcfd3fe2e9eac2859fd1ed86d2ab8c5a2f9352' : 
      '0x0';
  // Impersonate the Arbitrum TokenMinter and mint token to recipient
  for (let burnEvent of burnEvents) {
    const { recipient, amount, sourceDomain, burnToken } = burnEvent;
    const localTokenMessengerSigner = await impersonateAddress(
      bridgeDeploymentManager,
      ImpersonateLocalTokenMessenger
    );

    const transactionRequest = await localTokenMessengerSigner.populateTransaction({
      to: TokenMinter.address,
      from: ImpersonateLocalTokenMessenger,
      data: TokenMinter.interface.encodeFunctionData('mint', [sourceDomain, burnToken, utils.getAddress(recipient), amount]),
      gasPrice: 0
    });

    await setNextBaseFeeToZero(bridgeDeploymentManager);

    await (
      await localTokenMessengerSigner.sendTransaction(transactionRequest)
    ).wait();
  }
}
