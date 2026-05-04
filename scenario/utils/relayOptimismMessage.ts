import { DeploymentManager } from '../../plugins/deployment_manager';
import { impersonateAddress } from '../../plugins/scenario/utils';
import { setNextBaseFeeToZero, setNextBlockTimestamp } from './hreUtils';
import { BigNumber, ethers, utils, Contract } from 'ethers';
import { Log } from '@ethersproject/abstract-provider';
import { OpenBridgedProposal } from '../context/Gov';
import { applyL1ToL2Alias, isTenderlyLog } from './index';

export default async function relayOptimismMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  startingBlockNumber: number,
  tenderlyLogs?: any[]
) {
  const opL1CrossDomainMessenger = await governanceDeploymentManager.getContractOrThrow('opL1CrossDomainMessenger');
  const bridgeReceiver = await bridgeDeploymentManager.getContractOrThrow('bridgeReceiver');
  const l2CrossDomainMessenger = await bridgeDeploymentManager.getContractOrThrow('l2CrossDomainMessenger');
  const l2StandardBridge = await bridgeDeploymentManager.getContractOrThrow('l2StandardBridge');

  const openBridgedProposals: OpenBridgedProposal[] = [];

  const filter = opL1CrossDomainMessenger.filters.SentMessage();
  let sentMessageEvents: Log[] = [];

  if (tenderlyLogs) {
    const topic = opL1CrossDomainMessenger.interface.getEventTopic('SentMessage');
    const tenderlyEvents = tenderlyLogs.filter(
      log => log.raw?.topics?.[0] === topic && log.raw?.address?.toLowerCase() === opL1CrossDomainMessenger.address.toLowerCase()
    );
    const realEvents = await governanceDeploymentManager.hre.ethers.provider.getLogs({
      fromBlock: startingBlockNumber,
      toBlock: 'latest',
      address: opL1CrossDomainMessenger.address,
      topics: filter.topics!
    });
    sentMessageEvents = [...realEvents, ...tenderlyEvents];
  } else {
    sentMessageEvents = await governanceDeploymentManager.hre.ethers.provider.getLogs({
      fromBlock: startingBlockNumber,
      toBlock: 'latest',
      address: opL1CrossDomainMessenger.address,
      topics: filter.topics!
    });
  }

  for (let sentMessageEvent of sentMessageEvents) {
    let parsed;
    if (isTenderlyLog(sentMessageEvent)) {
      parsed = opL1CrossDomainMessenger.interface.parseLog({
        topics: sentMessageEvent.raw.topics,
        data: sentMessageEvent.raw.data
      });
    } else {
      parsed = opL1CrossDomainMessenger.interface.parseLog(sentMessageEvent);
    }

    const { target, sender, message, messageNonce, gasLimit } = parsed.args;

    const aliasedSigner = await impersonateAddress(
      bridgeDeploymentManager,
      applyL1ToL2Alias(opL1CrossDomainMessenger.address)
    );

    await setNextBaseFeeToZero(bridgeDeploymentManager);

    let relayMessageTxn;
    if (tenderlyLogs) {
      const callData = l2CrossDomainMessenger.interface.encodeFunctionData('relayMessage', [
        messageNonce,
        sender,
        target,
        0,
        0,
        message
      ]);
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
        0,
        message,
        { gasPrice: 0, gasLimit }
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
        const [ l1Token, _l2Token, _from, to, amount, _data ] = ethers.utils.defaultAbiCoder.decode(
          ['address l1Token', 'address l2Token', 'address from', 'address to', 'uint256 amount', 'bytes data'],
          messageWithoutSigHash
        );

        console.log(
          `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Bridged over ${amount} of ${l1Token} to user ${to}`
        );
      } catch (e) {
        // 1a. Bridging ETH
        const [ _from, to, amount, _data ] = ethers.utils.defaultAbiCoder.decode(
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
      try {
        const proposalCreatedEvent = relayMessageTxn.events.find(event => event.address === bridgeReceiver.address);
        const { args: { id, eta } } = bridgeReceiver.interface.parseLog(proposalCreatedEvent);
        // Add the proposal to the list of open bridged proposals to be executed after all the messages have been relayed
        openBridgedProposals.push({ id, eta });
      } catch (e) {
        if(relayMessageTxn.events[0].event === 'FailedRelayedMessage'){
          console.log('Failed to relay message');
          continue;
        }
        throw e;
      }
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

    if (tenderlyLogs) {
      const callData = bridgeReceiver.interface.encodeFunctionData('executeProposal', [id]);
      const signer = await bridgeDeploymentManager.getSigner();

      bridgeDeploymentManager.stashRelayMessage(
        bridgeReceiver.address,
        callData,
        signer.address
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

export async function simulateL2ToL1TokenBridging(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  tenderlyLogs?: any[]
) {
  if(tenderlyLogs) {
    return;
  }
  console.log('Simulating L2→L1 token bridging for any executed Optimism proposals...');

  // L2 contracts
  const bridgeReceiver = await bridgeDeploymentManager.getContractOrThrow('bridgeReceiver');
  const optimismL2Bridge = await bridgeDeploymentManager.getContractOrThrow('l2StandardBridge');
  const l2CrossDomainMessenger = await bridgeDeploymentManager.getContractOrThrow('l2CrossDomainMessenger');

  // L1 contracts
  const opL1CrossDomainMessenger = await governanceDeploymentManager.getContractOrThrow('opL1CrossDomainMessenger');
  const optimismL1Bridge = await governanceDeploymentManager.getContractOrThrow('opL1StandardBridge');
  const OPTIMISM_L1_PORTAL = '0xbEb5Fc579115071764c7423A4f12eDde41f106Ed';

  // Parse recent ProposalCreated events to find actions that bridge tokens from L2 to L1
  // ProposalCreated(address indexed rootMessageSender, uint256 id, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 eta)
  console.log('Fetching recent ProposalCreated events from BridgeReceiver...');
  const latestBlockNumber = await bridgeDeploymentManager.hre.ethers.provider.getBlockNumber();
  const proposalCreatedEvents = await bridgeDeploymentManager.hre.ethers.provider.getLogs({
    fromBlock: latestBlockNumber - 1000, // look back 1000 blocks for ProposalCreated events, which should be sufficient to cover any recent proposals given typical block times on Optimism
    toBlock: 'latest',
    address: bridgeReceiver.address,
    topics: [utils.id('ProposalCreated(address,uint256,address[],uint256[],string[],bytes[],uint256)')]
  });

  const bridgeERC20ToSignature = 'bridgeERC20To(address,address,address,uint256,uint32,bytes)';
  const depositForBurnSignature = 'depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)';

  for (const event of proposalCreatedEvents) {
    const decodedEvent = bridgeReceiver.interface.parseLog(event);
    const { signatures, calldatas } = decodedEvent.args;

    for (let i = 0; i < signatures.length; i++) {
      if (signatures[i] === bridgeERC20ToSignature) {
        const [localToken, remoteToken, to, amount, , extraData] = utils.defaultAbiCoder.decode(
          ['address', 'address', 'address', 'uint256', 'uint32', 'bytes'],
          calldatas[i]
        );

        console.log(`Simulating L2→L1 bridgeERC20To: ${amount.toString()} of ${remoteToken} to ${to}`);

        console.log('Setting up L1 state to simulate finalizeBridgeERC20...');
        console.log('Optimism L1 Portal address:', OPTIMISM_L1_PORTAL);
        console.log('Overriding slot', utils.hexZeroPad('0x32', 32));
        console.log('l2CrossDomainMessenger:', utils.hexZeroPad(l2CrossDomainMessenger.address, 32));
        await governanceDeploymentManager.hre.network.provider.send('hardhat_setStorageAt', [
          OPTIMISM_L1_PORTAL,
          utils.hexZeroPad('0x32', 32),
          utils.hexZeroPad(l2CrossDomainMessenger.address, 32)
        ]);

        await governanceDeploymentManager.hre.network.provider.send('hardhat_setStorageAt', [
          opL1CrossDomainMessenger.address,
          '0xcc',
          utils.hexZeroPad(optimismL2Bridge.address, 32)
        ]);

        const domainMessengerSigner = await impersonateAddress(
          governanceDeploymentManager,
          opL1CrossDomainMessenger.address
        );
        await governanceDeploymentManager.hre.network.provider.send('hardhat_setBalance', [
          domainMessengerSigner.address,
          ethers.utils.hexStripZeros(ethers.utils.parseEther('1').toHexString()),
        ]);

        await (
          await optimismL1Bridge.connect(domainMessengerSigner).finalizeBridgeERC20(
            remoteToken, localToken, bridgeReceiver.address, to, amount, extraData,
            { gasPrice: 0, gasLimit: 2_500_000 }
          )
        ).wait();
        await governanceDeploymentManager.hre.network.provider.send('hardhat_setStorageAt', [
          OPTIMISM_L1_PORTAL,
          utils.hexZeroPad('0x32', 32),
          utils.hexZeroPad('0xdead', 32)
        ]);
      }

      // Look for L2→L1 CCTP depositForBurn calls (Circle CCTP bridge, e.g. native USDC)
      if (signatures[i] === depositForBurnSignature) {
        const [amount, , mintRecipientBytes32, burnToken] = utils.defaultAbiCoder.decode(
          ['uint256', 'uint32', 'bytes32', 'address', 'bytes32', 'uint256', 'uint32'],
          calldatas[i]
        );

        const mintRecipient = utils.getAddress('0x' + utils.hexlify(mintRecipientBytes32).slice(-40));

        try {
          // L2
          const l2CCTPTokenMessenger = await bridgeDeploymentManager.getContractOrThrow('CCTPMessageTransmitter');
          // Resolve L1 token via CCTP TokenMinter: burnToken (L2) → localToken (L1)
          const l1CCTPTokenMessenger = await governanceDeploymentManager.getContractOrThrow('CCTPTokenMessenger');
          const tokenMinterAddress = await l1CCTPTokenMessenger.localMinter();
          const L1TokenMinter = new Contract(
            tokenMinterAddress,
            ['function mint(uint32 sourceDomain, bytes32 burnToken, address recipientOne, address recipientTwo, uint256 amountOne, uint256 amountTwo) returns (address)'],
            await governanceDeploymentManager.getSigner()
          );
          const l1CCTPTokenMessengerSigner = await impersonateAddress(
            governanceDeploymentManager,
            l1CCTPTokenMessenger.address
          );
          await governanceDeploymentManager.hre.network.provider.send('hardhat_setBalance', [
            l1CCTPTokenMessengerSigner.address,
            '0x1000000000000000000',
          ]);
          const sourceDomain = await l2CCTPTokenMessenger.localDomain();
          const mintTx = await L1TokenMinter.connect(l1CCTPTokenMessengerSigner).mint(
            sourceDomain,
            utils.hexZeroPad(burnToken, 32),
            mintRecipient,
            L1TokenMinter.address, // mint to the token minter first, since some tokens (e.g. USDC) have a cap on max amount per mint, and the token minter can then transfer to the recipient
            amount,
            1
          );
          console.log('Simulated CCTP mint transaction:', mintTx.hash);
          await mintTx.wait();
        } catch (e) {
          console.log(`Warning: Could not simulate CCTP L2→L1 bridging for depositForBurn: ${e.message}`);
        }
      }
    }
  }
}
