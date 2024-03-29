import { DeploymentManager } from '../../plugins/deployment_manager';
import { setNextBaseFeeToZero, setNextBlockTimestamp } from './hreUtils';
import { Log } from '@ethersproject/abstract-provider';
import { impersonateAddress } from '../../plugins/scenario/utils';
import { OpenBridgedProposal } from '../context/Gov';
import { BigNumber, ethers } from 'ethers';

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
  const l2ERC20Gateway = await bridgeDeploymentManager.getContractOrThrow('l2ERC20Gateway');
  const l2ETHGateway = await bridgeDeploymentManager.getContractOrThrow('l2ETHGateway');
  const l2WETHGateway = await bridgeDeploymentManager.getContractOrThrow('l2WETHGateway');
  const l2WstETHGateway = await bridgeDeploymentManager.getContractOrThrow('l2WstETHGateway');

  const openBridgedProposals: OpenBridgedProposal[] = [];

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

    let aliasAccount;
    if (bridgeDeploymentManager.network == 'scroll-goerli'){
      aliasAccount = await impersonateAddress(
        bridgeDeploymentManager,
        '0xD69c917c7F1C0a724A51c189B4A8F4F8C8E8cA0a'
      );
    } else {
      aliasAccount = await impersonateAddress(
        bridgeDeploymentManager,
        applyL1ToL2Alias(scrollMessenger.address)
      );
    }    

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

    const messageWithoutPrefix = message.slice(2); // strip out the 0x prefix
    const messageWithoutSigHash = '0x' + messageWithoutPrefix.slice(8);

    // Try to decode the SentMessage data to determine what type of cross-chain activity this is. So far,
    // there are two types:
    // 1. Bridging ERC20 token or ETH
    // 2. Cross-chain message passing
    if (target === l2ERC20Gateway.address) {
      // 1a. Bridging ERC20 token
      const { l1Token, _l2Token, _from, to, amount, _data } = ethers.utils.defaultAbiCoder.decode(
        ['address _l1Token', 'address _l2Token','address _from', 'address _to','uint256 _amount', 'bytes _data'],
        messageWithoutSigHash
      );
  
      console.log(
        `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Bridged over ${amount} of ${l1Token} to user ${to}`
      );
    } else if (target === l2ETHGateway.address){
      // 1a. Bridging ETH
      const { _from, to, amount, _data } = ethers.utils.defaultAbiCoder.decode(
        ['address _from', 'address _to', 'uint256 _amount', 'bytes _data'],
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
    }else if (target === l2WETHGateway.address){
      // 1c. Bridging WETH
      const { _l1Token, _l2Token, _from, to, amount, _data } = ethers.utils.defaultAbiCoder.decode(
        ['address _l1Token', 'address _l2Token','address _from', 'address _to','uint256 _amount', 'bytes _data'],
        messageWithoutSigHash
      );
  
      console.log(
        `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Bridged over ${amount} of WETH to user ${to}`
      );
    } else if (target === l2WstETHGateway.address){
      // 1d. Bridging WstETH
      const { _l1Token, _l2Token, _from, to, amount, _data } = ethers.utils.defaultAbiCoder.decode(
        ['address _l1Token', 'address _l2Token','address _from', 'address _to','uint256 _amount', 'bytes _data'],
        messageWithoutSigHash
      );
  
      console.log(
        `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Bridged over ${amount} of WstETH to user ${to}`
      );
    } else if (target === bridgeReceiver.address) {
      // Cross-chain message passing
      const proposalCreatedEvent = relayMessageTxn.events.find(event => event.address === bridgeReceiver.address);
      const { args: { id, eta } } = bridgeReceiver.interface.parseLog(proposalCreatedEvent);
  
      // Add the proposal to the list of open bridged proposals to be executed after all the messages have been relayed
      openBridgedProposals.push({ id, eta });
    } else {
      throw new Error(`[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Unrecognized target for cross-chain message`);
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
