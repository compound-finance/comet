import { DeploymentManager } from '../../plugins/deployment_manager';
import { impersonateAddress } from '../../plugins/scenario/utils';
import { setNextBaseFeeToZero, setNextBlockTimestamp } from './hreUtils';
import { BigNumber, ethers, utils } from 'ethers';
import { Log } from '@ethersproject/abstract-provider';
import { OpenBridgedProposal } from '../context/Gov';

function applyL1ToL2Alias(address: string) {
  const offset = BigInt('0x1111000000000000000000000000000000001111');
  return `0x${(BigInt(address) + offset).toString(16)}`;
}

function isTenderlyLog(log: any): log is { raw: { topics: string[], data: string } } {
  return !!log?.raw?.topics && !!log?.raw?.data;
}

export async function relayUnichainMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  startingBlockNumber: number,
  tenderlyLogs?: any[]
) {
  const unichainL1CrossDomainMessenger = await governanceDeploymentManager.getContractOrThrow('unichainL1CrossDomainMessenger');
  const bridgeReceiver = await bridgeDeploymentManager.getContractOrThrow('bridgeReceiver');
  const l2CrossDomainMessenger = await bridgeDeploymentManager.getContractOrThrow('l2CrossDomainMessenger');
  const l2StandardBridge = await bridgeDeploymentManager.getContractOrThrow('l2StandardBridge');

  const openBridgedProposals: OpenBridgedProposal[] = [];

  // Grab all events on the L1CrossDomainMessenger contract since the `startingBlockNumber`
  const filter = unichainL1CrossDomainMessenger.filters.SentMessage();
  let sentMessageEvents: Log[] = [];

  if (tenderlyLogs) {
    const topic = unichainL1CrossDomainMessenger.interface.getEventTopic('SentMessage');
    const tenderlyEvents = tenderlyLogs.filter(
      log => log.raw?.topics?.[0] === topic && log.raw?.address?.toLowerCase() === unichainL1CrossDomainMessenger.address.toLowerCase()
    );
    const realEvents = await governanceDeploymentManager.hre.ethers.provider.getLogs({
      fromBlock: startingBlockNumber,
      toBlock: 'latest',
      address: unichainL1CrossDomainMessenger.address,
      topics: filter.topics!
    });
    sentMessageEvents = [...realEvents, ...tenderlyEvents];
  } else {
    sentMessageEvents = await governanceDeploymentManager.hre.ethers.provider.getLogs({
      fromBlock: startingBlockNumber,
      toBlock: 'latest',
      address: unichainL1CrossDomainMessenger.address,
      topics: filter.topics!
    });
  }

  for (let sentMessageEvent of sentMessageEvents) {
    let parsed;
    if (isTenderlyLog(sentMessageEvent)) {
      parsed = unichainL1CrossDomainMessenger.interface.parseLog({
        topics: sentMessageEvent.raw.topics,
        data: sentMessageEvent.raw.data
      });
    } else {
      parsed = unichainL1CrossDomainMessenger.interface.parseLog(sentMessageEvent);
    }

    const { sender, target, message, messageNonce, gasLimit } = parsed.args;
    const aliasedSigner = await impersonateAddress(
      bridgeDeploymentManager,
      applyL1ToL2Alias(unichainL1CrossDomainMessenger.address)
    );

    await setNextBaseFeeToZero(bridgeDeploymentManager);

    let relayMessageTxn: { events: any[] };
    if (tenderlyLogs) {
      const callData = l2CrossDomainMessenger.interface.encodeFunctionData('relayMessage', [messageNonce, sender, target, 0, 0, message]);
      bridgeDeploymentManager.stashRelayMessage(
        l2CrossDomainMessenger.address,
        callData,
        aliasedSigner.address
      );
    }
    relayMessageTxn = await (
      await l2CrossDomainMessenger.connect(aliasedSigner).relayMessage(
        messageNonce,
        sender,
        target,
        0,
        gasLimit,
        message,
        { gasPrice: 0, gasLimit: 7_500_000 }
      )
    ).wait();
    

    // Try to decode the SentMessage data to determine what type of cross-chain activity this is. So far,
    // there are two types:
    // 1. Bridging ERC20 token or ETH
    // 2. Cross-chain message passing
    if (target === l2StandardBridge.address) {
      // Bridging ERC20 token
      const messageWithoutPrefix = message.slice(2); // strip out the 0x prefix
      const messageWithoutSigHash = '0x' + messageWithoutPrefix.slice(8);
      try {
        // 1a. Bridging ERC20 token
        const { l1Token, _l2Token, _from, to, amount, _data } = ethers.utils.defaultAbiCoder.decode(
          ['address l1Token', 'address l2Token', 'address from', 'address to', 'uint256 amount', 'bytes data'],
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
        // This is our best attempt to mimic the deposit transaction type (not supported in Hardhat) that Unichain uses to deposit ETH to an L2 address
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
        const proposalCreatedEvent = relayMessageTxn.events.find(event => event.address === bridgeReceiver.address);
        const { args: { id, eta } } = bridgeReceiver.interface.parseLog(proposalCreatedEvent);

        // Add the proposal to the list of open bridged proposals to be executed after all the messages have been relayed
        openBridgedProposals.push({ id, eta });
      }
    } else {
      throw new Error(`[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Unrecognized target for cross-chain message`);
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
      const signer = await bridgeDeploymentManager.getSigner();
      const callData = bridgeReceiver.interface.encodeFunctionData('executeProposal', [id]);
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

export async function relayUnichainCCTPMint(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  startingBlockNumber: number,
  tenderlyLogs?: any[]
){

  // CCTP relay
  // L1 contracts
  const L1MessageTransmitter = await governanceDeploymentManager.getContractOrThrow('CCTPMessageTransmitter');
  // L2 TokenMinter
  const TokenMinter = await bridgeDeploymentManager.getContractOrThrow('TokenMinter');

  let depositForBurnEvents: Log[] = [];

  if (tenderlyLogs) {
    const messageSentTopic = utils.id('MessageSent(bytes)');

    const tenderlyEvents = tenderlyLogs.filter(log =>
      log.raw?.topics?.[0] === messageSentTopic &&
      log.raw?.address?.toLowerCase() === L1MessageTransmitter.address.toLowerCase()
    );

    const realEvents = await governanceDeploymentManager.hre.ethers.provider.getLogs({
      fromBlock: startingBlockNumber,
      toBlock: 'latest',
      address: L1MessageTransmitter.address,
      topics: [messageSentTopic]
    });

    depositForBurnEvents = [...realEvents, ...tenderlyEvents];
  } else {
    depositForBurnEvents = await governanceDeploymentManager.hre.ethers.provider.getLogs({
      fromBlock: startingBlockNumber,
      toBlock: 'latest',
      address: L1MessageTransmitter.address,
      topics: [utils.id('MessageSent(bytes)')]
    });
  }

  // Decode message body
  console.log(`Found ${depositForBurnEvents.length} CCTP deposit for burn events`);

  const burnEvents = depositForBurnEvents.map((event) => {
    let data;
    
    if (isTenderlyLog(event)) {
      data = event.raw.data;
    } else {
      data = event.data;
    }

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

  // Impersonate the Unichain TokenMinter and mint token to recipient
  const ImpersonateLocalTokenMessenger = bridgeDeploymentManager.network === 'unichain' ? await TokenMinter.localTokenMessenger() : '0x0';
  // Impersonate the Unichain TokenMinter and mint token to recipient
  for (let burnEvent of burnEvents) {
    const { recipient, amount, sourceDomain, burnToken } = burnEvent;
    // 0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48
    console.log(`Minting ${amount} of ${burnToken.replace(/^0x0{24}/, '0x')} to ${recipient} on ${bridgeDeploymentManager.network}`);
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
    if( tenderlyLogs ) {
      const callData = TokenMinter.interface.encodeFunctionData('mint', [sourceDomain, burnToken, utils.getAddress(recipient), amount]);
      bridgeDeploymentManager.stashRelayMessage(
        TokenMinter.address,
        callData,
        localTokenMessengerSigner.address
      );
    } else {
      await (
        await localTokenMessengerSigner.sendTransaction(transactionRequest)
      ).wait();
    }
  }
}