import { DeploymentManager } from '../../plugins/deployment_manager';
import { setNextBaseFeeToZero, setNextBlockTimestamp } from './hreUtils';
import { constants, ethers } from 'ethers';
import { Log } from '@ethersproject/abstract-provider';
import { OpenBridgedProposal } from '../context/Gov';
import { impersonateAddress } from '../../plugins/scenario/utils';

const LINEA_SETTER_ROLE_ACCOUNT = '0x0f2b2747d1861f8fc016bf5b60d95f1a511b7e08';

export default async function relayLineaMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  startingBlockNumber: number
) {
  const lineaMessageService = await governanceDeploymentManager.getContractOrThrow(
    'lineaMessageService'
  );
  const bridgeReceiver = await bridgeDeploymentManager.getContractOrThrow('bridgeReceiver');
  const l2MessageService = await bridgeDeploymentManager.getContractOrThrow('l2MessageService');
  const l2TokenBridge = await bridgeDeploymentManager.getContractOrThrow('l2TokenBridge');
  const l2usdcBridge = await bridgeDeploymentManager.getContractOrThrow('l2usdcBridge');

  const openBridgedProposals: OpenBridgedProposal[] = [];
  // Grab all events on the L1CrossDomainMessenger contract since the `startingBlockNumber`
  const filter = lineaMessageService.filters.MessageSent();
  const messageSentEvents: Log[] = await governanceDeploymentManager.hre.ethers.provider.getLogs({
    fromBlock: startingBlockNumber,
    toBlock: 'latest',
    address: lineaMessageService.address,
    topics: filter.topics!
  });
  for (let messageSentEvent of messageSentEvents) {
    const {
      args: { _from, _to, _fee, _value, _nonce, _calldata, _messageHash }
    } = lineaMessageService.interface.parseLog(messageSentEvent);

    await setNextBaseFeeToZero(bridgeDeploymentManager);

    const aliasSetterRoleAccount = await impersonateAddress(
      bridgeDeploymentManager,
      LINEA_SETTER_ROLE_ACCOUNT
    );
    // First the message's hash has to be added by a specific account in the "contract's queue"
    await l2MessageService.connect(aliasSetterRoleAccount).addL1L2MessageHashes([_messageHash]);

    const relayMessageTxn = await (
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

    // Try to decode the SentMessage data to determine what type of cross-chain activity this is. So far,
    // there are two types:
    // 1. Bridging ERC20 token
    // 2. Cross-chain message passing
    if (_to === l2TokenBridge.address) {
      // Bridging ERC20 token
      const messageWithoutPrefix = _calldata.slice(2); // strip out the 0x prefix
      const messageWithoutSigHash = '0x' + messageWithoutPrefix.slice(8);

      // Bridging ERC20 token
      const { l1Token, amount, to, _data } = ethers.utils.defaultAbiCoder.decode(
        ['address _nativeToken', 'address _amount', 'uint256 _recipient', 'bytes _tokenMetadata'],
        messageWithoutSigHash
      );

      console.log(
        `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Bridged over ${amount} of ${l1Token} to user ${to}`
      );
    } else if (_to === l2usdcBridge.address) {
      console.log(
        `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Bridged USDC`
      );
    } else if (_to === bridgeReceiver.address) {
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
