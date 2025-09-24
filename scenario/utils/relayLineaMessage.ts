import { DeploymentManager } from '../../plugins/deployment_manager';
import { setNextBaseFeeToZero, setNextBlockTimestamp } from './hreUtils';
import { constants, ethers } from 'ethers';
import { Log } from '@ethersproject/abstract-provider';
import { OpenBridgedProposal } from '../context/Gov';
import { impersonateAddress } from '../../plugins/scenario/utils';
import { isTenderlyLog } from './index';

const LINEA_SETTER_ROLE_ACCOUNT = '0xc1C6B09D1eB6fCA0fF3cA11027E5Bc4AeDb47F67';

function isTenderlyLog(log: any): log is { raw: { topics: string[], data: string } } {
  return !!log?.raw?.topics && !!log?.raw?.data;
}

export default async function relayLineaMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  startingBlockNumber: number,
  tenderlyLogs?: any[]
) {

  const lineaMessageService = await governanceDeploymentManager.getContractOrThrow(
    'lineaMessageService'
  );
  const lineaL1USDCBridge = await governanceDeploymentManager.getContractOrThrow(
    'lineaL1USDCBridge'
  );
  const timelock = await governanceDeploymentManager.getContractOrThrow(
    'timelock'
  );
  const lineaL1TokenBridge = await governanceDeploymentManager.getContractOrThrow(
    'lineaL1TokenBridge'
  );
  const bridgeReceiver = await bridgeDeploymentManager.getContractOrThrow('bridgeReceiver');
  const l2USDCBridge = await bridgeDeploymentManager.getContractOrThrow('l2USDCBridge');
  const l2MessageService = await bridgeDeploymentManager.getContractOrThrow('l2MessageService');
  const l2StandardBridge = await bridgeDeploymentManager.getContractOrThrow('l2StandardBridge');
  const openBridgedProposals: OpenBridgedProposal[] = [];
  // Grab all events on the L1CrossDomainMessenger contract since the `startingBlockNumber`
  const filter = lineaMessageService.filters.MessageSent();
  const filterRollingHash = lineaMessageService.filters.RollingHashUpdated();
  let messageSentEvents: Log[] = [];
  let rollingHashUpdatedEvents: Log[] = [];
  
  if (tenderlyLogs) {
  
    const msgTopic = lineaMessageService.interface.getEventTopic('MessageSent');
    const hashTopic = lineaMessageService.interface.getEventTopic('RollingHashUpdated');
  
    const tenderlyMsgEvents = tenderlyLogs.filter(log =>
      log.raw?.topics?.[0] === msgTopic &&
      log.raw?.address?.toLowerCase() === lineaMessageService.address.toLowerCase()
    );
  
    const tenderlyHashEvents = tenderlyLogs.filter(log =>
      log.raw?.topics?.[0] === hashTopic &&
      log.raw?.address?.toLowerCase() === lineaMessageService.address.toLowerCase()
    );
  
    // getLogs version:
    const fromBlock = Math.max(0, startingBlockNumber - 50000);
    const toBlock = await governanceDeploymentManager.hre.ethers.provider.getBlockNumber();

    const realMsgEvents = await fetchLogsInChunks(
      governanceDeploymentManager.hre.ethers.provider,
      filter,
      fromBlock,
      toBlock,
      lineaMessageService.address
    );

    const realHashEvents = await fetchLogsInChunks(
      governanceDeploymentManager.hre.ethers.provider,
      filterRollingHash,
      fromBlock,
      toBlock,
      lineaMessageService.address
    );

    messageSentEvents = [...realMsgEvents, ...tenderlyMsgEvents];
    rollingHashUpdatedEvents = [...realHashEvents, ...tenderlyHashEvents];
  } else {
    const fromBlock = Math.max(0, startingBlockNumber - 50000);
    const toBlock = await governanceDeploymentManager.hre.ethers.provider.getBlockNumber();

    messageSentEvents = await fetchLogsInChunks(
      governanceDeploymentManager.hre.ethers.provider,
      filter,
      fromBlock,
      toBlock,
      lineaMessageService.address
    );

    rollingHashUpdatedEvents = await fetchLogsInChunks(
      governanceDeploymentManager.hre.ethers.provider,
      filterRollingHash,
      fromBlock,
      toBlock,
      lineaMessageService.address
    );
  }

  for (let i = 0; i < messageSentEvents.length; i++) {
    const messageSentEvent = messageSentEvents[i];
    const rollingHashUpdatedEvent = rollingHashUpdatedEvents[i];

    let parsedMessage, parsedRolling;

    if (isTenderlyLog(messageSentEvent)) {
      parsedMessage = lineaMessageService.interface.parseLog({
        topics: messageSentEvent.raw.topics,
        data: messageSentEvent.raw.data,
      });
    } else {
      parsedMessage = lineaMessageService.interface.parseLog(messageSentEvent);
    }

    if (isTenderlyLog(rollingHashUpdatedEvent)) {
      parsedRolling = lineaMessageService.interface.parseLog({
        topics: rollingHashUpdatedEvent.raw.topics,
        data: rollingHashUpdatedEvent.raw.data,
      });
    } else {
      parsedRolling = lineaMessageService.interface.parseLog(rollingHashUpdatedEvent);
    }

    const { _from, _to, _fee, _value, _nonce, _calldata, _messageHash } = parsedMessage.args;
    const { messageNumber, rollingHash, messageHash } = parsedRolling.args;

    if((await l2MessageService.lastAnchoredL1MessageNumber()).gte(messageNumber)) continue;

    await setNextBaseFeeToZero(bridgeDeploymentManager);

    const aliasSetterRoleAccount = await impersonateAddress(
      bridgeDeploymentManager,
      LINEA_SETTER_ROLE_ACCOUNT
    );

    let callData;
    // First the message's hash has to be added by a specific account in the "contract's queue"
    if((await l2MessageService.lastAnchoredL1MessageNumber()).lte(messageNumber)){
      if(tenderlyLogs) {
        callData = l2MessageService.interface.encodeFunctionData('anchorL1L2MessageHashes', [
          [messageHash],
          messageNumber,
          messageNumber,
          rollingHash
        ]);

        bridgeDeploymentManager.stashRelayMessage(
          l2MessageService.address,
          callData,
          aliasSetterRoleAccount.address
        );
      }

      await l2MessageService.connect(aliasSetterRoleAccount).anchorL1L2MessageHashes(
        [messageHash],
        messageNumber,
        messageNumber,
        rollingHash
      );
    }
      

    let relayMessageTxn: { events: any[] }; 

    if(
      _from.toLowerCase() === timelock.address.toLowerCase()
      || _from.toLowerCase() === lineaL1TokenBridge.address.toLowerCase()
      || _from.toLowerCase() === lineaL1USDCBridge.address.toLowerCase()
    ){
      if(tenderlyLogs) {
        callData = l2MessageService.interface.encodeFunctionData('claimMessage', [
          _from,
          _to,
          _fee,
          _value,
          constants.AddressZero,
          _calldata,
          _nonce
        ]);
        const signer = await bridgeDeploymentManager.getSigner();
        bridgeDeploymentManager.stashRelayMessage(
          l2MessageService.address,
          callData,
          await signer.getAddress()
        );
      }
   

      relayMessageTxn = await (
        await l2MessageService.claimMessage(
          _from,
          _to,
          _fee,
          _value,
          constants.AddressZero,
          _calldata,
          _nonce,
          {
            gasPrice: 0,
            gasLimit: 10000000
          }
        )
      ).wait();
      
    } else continue;

    // Try to decode the SentMessage data to determine what type of cross-chain activity this is. So far,
    // there are two types:
    // 1. Bridging ERC20 token
    // 2. Cross-chain message passing
    if (_to.toLowerCase() === l2StandardBridge.address.toLowerCase()) {
      // Bridging ERC20 token
      const messageWithoutPrefix = _calldata.slice(2); // strip out the 0x prefix
      const messageWithoutSigHash = '0x' + messageWithoutPrefix.slice(8);

      // Bridging ERC20 token
      const [ l1Token, amount, to ] = ethers.utils.defaultAbiCoder.decode(
        ['address nativeToken', 'uint256 amount', 'address recipient'],
        messageWithoutSigHash
      );

      console.log(
        `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Bridged over ${amount} of ${l1Token} to user ${to}`
      );
    }
    else if (_to.toLowerCase() === l2USDCBridge.address.toLowerCase()){
      const messageWithoutPrefix = _calldata.slice(2); // strip out the 0x prefix
      const messageWithoutSigHash = '0x' + messageWithoutPrefix.slice(8);
      const [ to, amount ] = ethers.utils.defaultAbiCoder.decode(
        ['address _recipient', 'uint256 _amount'],
        messageWithoutSigHash
      );
      console.log(
        `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Bridged over ${amount} of USDC.e to user ${to}`
      );
    }
    else if (_to.toLowerCase() === bridgeReceiver.address.toLowerCase()) {
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
    if(tenderlyLogs) {
      const callData = bridgeReceiver.interface.encodeFunctionData('executeProposal', [id]);
      const signer = await bridgeDeploymentManager.getSigner();

      bridgeDeploymentManager.stashRelayMessage(
        bridgeReceiver.address,
        callData,
        await signer.getAddress()
      );
    }else{
      await bridgeReceiver.executeProposal(id, { gasPrice: 0 });
    }
   
    console.log(
      `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Executed bridged proposal ${id}`
    );
  }
  return openBridgedProposals;
}

// Helper to fetch logs in chunks of 10,000 blocks
async function fetchLogsInChunks(provider: any, filter: any, fromBlock: number, toBlock: number, address: string) {
  const chunkSize = 10000;
  let logs: Log[] = [];
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, toBlock);
    const chunkLogs = await provider.getLogs({
      fromBlock: start,
      toBlock: end,
      address,
      topics: filter.topics!
    });
    logs = logs.concat(chunkLogs);
  }
  return logs;
}
