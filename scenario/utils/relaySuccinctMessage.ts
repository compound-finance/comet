import { DeploymentManager } from '../../plugins/deployment_manager';
import { setNextBaseFeeToZero, setNextBlockTimestamp } from './hreUtils';
import { impersonateAddress } from '../../plugins/scenario/utils';
import { ethers } from 'ethers';
import { Log } from '@ethersproject/abstract-provider';
import { OpenBridgedProposal } from '../context/Gov';

function decodeMessage(message: string) {
  return {
    version: ethers.BigNumber.from(ethers.utils.hexDataSlice(message, 0, 1)).toNumber(),
    nonce: ethers.BigNumber.from(ethers.utils.hexDataSlice(message, 1, 9)).toBigInt(),
    sourceChainId: ethers.BigNumber.from(
      ethers.utils.hexDataSlice(message, 9, 13)
    ).toNumber(),
    senderAddress: ethers.utils.hexDataSlice(message, 13, 33).toLowerCase(),
    recipientChainId: ethers.BigNumber.from(
      ethers.utils.hexDataSlice(message, 33, 37)
    ).toNumber(),
    recipientAddress: ethers.utils.hexDataSlice(message, 37, 69).toLowerCase(),
    data: ethers.utils.hexDataSlice(message, 69).toLowerCase()
  };
}

export default async function relaySuccinctMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  startingBlockNumber: number
) {
  const L1TelepathyRouter = await governanceDeploymentManager.getContractOrThrow(
    'L1TelepathyRouter'
  );
  const bridgeReceiver = await bridgeDeploymentManager.getContractOrThrow('bridgeReceiver');
  const L2TelepathyRouter = await bridgeDeploymentManager.getContractOrThrow('L2TelepathyRouter');

  const openBridgedProposals: OpenBridgedProposal[] = [];
  // Grab all events on the L1CrossDomainMessenger contract since the `startingBlockNumber`
  const filter = L1TelepathyRouter.filters.SentMessage();
  const sentMessageEvents: Log[] = await governanceDeploymentManager.hre.ethers.provider.getLogs({
    fromBlock: startingBlockNumber,
    toBlock: 'latest',
    address: L1TelepathyRouter.address,
    topics: filter.topics!
  });
  for (let sentMessageEvent of sentMessageEvents) {
    const {
      args: { _nonce, _msgHash, _message }
    } = L1TelepathyRouter.interface.parseLog(sentMessageEvent);

    const aliasedSigner = await impersonateAddress(
      bridgeDeploymentManager,
      L2TelepathyRouter.address
    );

    const decodedMessage = decodeMessage(_message);

    await setNextBaseFeeToZero(bridgeDeploymentManager);

    // TODO: Fill in the following variables with the correct values
    const srcSlotTxSlotPack = "";
    const receiptsRootProof = "";
    const receiptsRoot = "";
    const receiptProof = "";
    const txIndexRLPEncoded = "";
    const logIndex = 0;

    const relayMessageTxn = await (
      await L2TelepathyRouter.connect(aliasedSigner).executeMessage(
        srcSlotTxSlotPack,
        _message,
        receiptsRootProof,
        receiptsRoot,
        receiptProof,
        txIndexRLPEncoded,
        logIndex,
        {
          gasPrice: 0,
          gasLimit: 10000000
        }
      )
    ).wait();

    // Try to decode the SentMessage data to determine what type of cross-chain activity this is. So far,
    // there is one type:
    // 1. Cross-chain message passing to bridgeReceiver
    if (decodedMessage.recipientAddress == bridgeReceiver.address) {
      const proposalCreatedEvent = relayMessageTxn.events.find(
        event => event.address === bridgeReceiver.address
      );
      const {
        args: { id, eta }
      } = bridgeReceiver.interface.parseLog(proposalCreatedEvent);

      // Add the proposal to the list of open bridged proposals to be executed after all the messages have been relayed
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
    await bridgeReceiver.executeProposal(id, { gasPrice: 0 });
    console.log(
      `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Executed bridged proposal ${id}`
    );
  }
}