import { DeploymentManager } from '../../plugins/deployment_manager';
import { impersonateAddress } from '../../plugins/scenario/utils';
import { setNextBaseFeeToZero, setNextBlockTimestamp } from './hreUtils';
import { utils, BigNumber, Contract, constants } from 'ethers';
import { Log } from '@ethersproject/abstract-provider';
import { sourceTokens } from '../../plugins/scenario/utils/TokenSourcer';
import { OpenBridgedProposal } from '../context/Gov';
import { isTenderlyLog } from './index';

export async function relayArbitrumMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  startingBlockNumber: number,
  tenderlyLogs?: any[]
) {
  // L1 contracts
  const inbox = await governanceDeploymentManager.getContractOrThrow('arbitrumInbox'); // Inbox -> Bridge
  const bridge = await governanceDeploymentManager.getContractOrThrow('arbitrumBridge');

  // L2 contracts
  const bridgeReceiver = await bridgeDeploymentManager.getContractOrThrow('bridgeReceiver');

  let inboxMessageDeliveredEvents: Log[] = [];
  let messageDeliveredEvents: Log[] = [];
  const openBridgedProposals: OpenBridgedProposal[] = [];

  if (tenderlyLogs) {
    const inboxTopic = utils.id('InboxMessageDelivered(uint256,bytes)');
    const bridgeTopic = utils.id('MessageDelivered(uint256,bytes32,address,uint8,address,bytes32,uint256,uint64)');

    const tenderlyInboxEvents = tenderlyLogs.filter(log =>
      log.raw?.topics?.[0] === inboxTopic &&
      log.raw?.address?.toLowerCase() === inbox.address.toLowerCase()
    );

    const tenderlyBridgeEvents = tenderlyLogs.filter(log =>
      log.raw?.topics?.[0] === bridgeTopic &&
      log.raw?.address?.toLowerCase() === bridge.address.toLowerCase()
    );

    const realInboxEvents = await governanceDeploymentManager.hre.ethers.provider.getLogs({
      fromBlock: startingBlockNumber,
      toBlock: 'latest',
      address: inbox.address,
      topics: [inboxTopic]
    });

    const realBridgeEvents = await governanceDeploymentManager.hre.ethers.provider.getLogs({
      fromBlock: startingBlockNumber,
      toBlock: 'latest',
      address: bridge.address,
      topics: [bridgeTopic]
    });

    inboxMessageDeliveredEvents = [...realInboxEvents, ...tenderlyInboxEvents];
    messageDeliveredEvents = [...realBridgeEvents, ...tenderlyBridgeEvents];
  } else {
    inboxMessageDeliveredEvents = await governanceDeploymentManager.hre.ethers.provider.getLogs({
      fromBlock: startingBlockNumber,
      toBlock: 'latest',
      address: inbox.address,
      topics: [utils.id('InboxMessageDelivered(uint256,bytes)')]
    });

    messageDeliveredEvents = await governanceDeploymentManager.hre.ethers.provider.getLogs({
      fromBlock: startingBlockNumber,
      toBlock: 'latest',
      address: bridge.address,
      topics: [utils.id('MessageDelivered(uint256,bytes32,address,uint8,address,bytes32,uint256,uint64)')]
    });
  }

  const dataAndTargets = inboxMessageDeliveredEvents.map((event) => {
    let data, topics;
    
    if (isTenderlyLog(event)) {
      data = event.raw.data;
      topics = event.raw.topics;
    } else {
      data = event.data;
      topics = event.topics;
    }

    const header = '0x';
    const headerLength = header.length;
    const wordLength = 2 * 32;
    const innnerData = header + data.slice(headerLength + (11 * wordLength));
    const toValue = data.slice(headerLength + (2 * wordLength), headerLength + (3 * wordLength));
    let toAddress = BigNumber.from(`0x${toValue}`).toHexString();
    
    // if length of toAddress is less than 42, then it is padded with 0s and we need to add them after 0x
    if(toAddress.length < 42) {
      toAddress = `0x${toAddress.slice(2).padStart(40, '0')}`;
    }

    const messageNum = topics[1];
    return {
      data: innnerData,
      toAddress,
      messageNum
    };
  });

  const senders = messageDeliveredEvents.map((event) => {
    let data, topics;
    
    if (isTenderlyLog(event)) {
      data = event.raw.data;
      topics = event.raw.topics;
    } else {
      data = event.data;
      topics = event.topics;
    }

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
    // if method name == finalizeInboundTransfer(address,address,address,uint256,bytes)
    if(data.slice(0, 10) == '0x2e567b36'){
      const _data = '0x' + data.slice(10, 266);
      const [token,, to, amount] = utils.defaultAbiCoder.decode(
        ['address', 'address', 'address', 'uint256'],
        _data
      );
      // if token is mainnet ETH -> than source arbitrum weth
      if(token == '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'){
        if(tenderlyLogs) {
          const callData = bridgeReceiver.interface.encodeFunctionData(
            'sourceTokens',
            [
              {
                dm: bridgeDeploymentManager,
                amount: amount,
                asset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
                address: to,
                blacklist: []
              }
            ]
          );

          bridgeDeploymentManager.stashRelayMessage(
            bridgeReceiver.address,
            callData,
            arbitrumSigner.address
          );
        }


        await sourceTokens({
          dm: bridgeDeploymentManager,
          amount: amount,
          asset: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
          address: to,
          blacklist: [],
        });

        continue;
      }
    }
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
    if(tenderlyLogs) {
      bridgeDeploymentManager.stashRelayMessage(
        toAddress,
        data,
        sender
      );
    }

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

      if(tenderlyLogs) {
        const signer = await bridgeDeploymentManager.getSigner();
        const callData = bridgeReceiver.interface.encodeFunctionData('executeProposal', [id]);
        bridgeDeploymentManager.stashRelayMessage(
          bridgeReceiver.address,
          callData,
          await signer.getAddress()
        );
      } else {
        // Mock ArbSys precompile (0x64) — Arbitrum precompiles don't exist in Hardhat's EVM,
        // but the L2 gateways call ArbSys.sendTxToL1 internally during outboundTransfer.
        // Bytecode 0x60206000f3 disassembles to: PUSH1 0x20 | PUSH1 0x00 | RETURN
        // which returns 32 zero bytes from uninitialized memory for any call.
        await bridgeDeploymentManager.hre.network.provider.request({
          method: 'hardhat_setCode',
          params: [
            '0x0000000000000000000000000000000000000064',
            '0x60206000f3',
          ],
        });

        await bridgeReceiver.executeProposal(id, { gasPrice: 0 });
      }
      openBridgedProposals.push({
        id: BigNumber.from(id),
        eta: BigNumber.from(eta)
      });
    }
  }

  return openBridgedProposals;
}

export async function simulateL2ToL1TokenBridging(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  tenderlyLogs?: any[],
  proposalId?: BigNumber
) {
  console.log('Simulating L2→L1 token bridging for any executed Arbitrum proposals...');
  // DO NOT SIMULATE IF TENDERLY LOGS ARE PROVIDED, AS THEY SHOULD ALREADY CONTAIN THE EFFECTS OF THE SIMULATION. THIS FUNCTION IS ONLY FOR SIMULATION PURPOSES IN NON-TENDERLY ENVIRONMENTS, AND SHOULD NOT BE CALLED IF TENDERLY LOGS ARE AVAILABLE.
  if(tenderlyLogs) {
    return;
  }

  // L2 contracts
  const bridgeReceiver = await bridgeDeploymentManager.getContractOrThrow('bridgeReceiver');

  // Parse recent ProposalCreated events to find actions that bridge tokens from L2 to L1
  // ProposalCreated(address indexed rootMessageSender, uint256 id, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 eta)
  console.log('Fetching recent ProposalCreated events from BridgeReceiver...');
  const latestBlockNumber = await bridgeDeploymentManager.hre.ethers.provider.getBlockNumber();
  const proposalCreatedEvents = await bridgeDeploymentManager.hre.ethers.provider.getLogs({
    fromBlock: latestBlockNumber - 1000, // look back 1000 blocks for ProposalCreated events, which should be sufficient to cover any recent proposals given typical block times on Arbitrum
    toBlock: 'latest',
    address: bridgeReceiver.address,
    topics: [utils.id('ProposalCreated(address,uint256,address[],uint256[],string[],bytes[],uint256)')]
  });
  const outboundTransferSignature = 'outboundTransfer(address,address,uint256,bytes)';
  const outboundTransfer2Signature = 'outboundTransfer(address,address,uint256,uint256,uint256,bytes)';
  const depositForBurnSignature = 'depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)';
  const ARBITRUM_GATEWAY_ROUTER = '0x5288c571Fd7aD117beA99bF60FE0846C4E84F933';
  const ARBITRUM_BRIDGE = '0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a';
  const ARBITRUM_OUTBOX = '0x667e23ABd27E623c11d4CC00ca3EC4d0bD63337a';
  const MAINNET_WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

  for (const event of proposalCreatedEvents) {
    const decodedEvent = bridgeReceiver.interface.parseLog(event);
    const { id, targets, signatures, calldatas } = decodedEvent.args;

    if (proposalId && id.toString() !== proposalId.toString()) {
      continue;
    }

    for (let i = 0; i < signatures.length; i++) {
      // Look for L2→L1 outboundTransfer calls (standard Arbitrum gateway bridge)
      if (signatures[i] === outboundTransferSignature || signatures[i] === outboundTransfer2Signature) {
        const [l1Token, to, amount] = (() => {
          if (signatures[i] === outboundTransferSignature) {
            return utils.defaultAbiCoder.decode(
              ['address', 'address', 'uint256', 'bytes'],
              calldatas[i]
            );
          } else if (signatures[i] === outboundTransfer2Signature) {
            return utils.defaultAbiCoder.decode(
              ['address', 'address', 'uint256', 'uint256', 'uint256', 'bytes'],
              calldatas[i]
            );
          }
        })();
        console.log(`Simulating L2→L1 token bridging: ${amount.toString()} of ${l1Token} to ${to}`);

        const gatewayAddress = await (async () => {
          if(targets[i].toLowerCase() === ARBITRUM_GATEWAY_ROUTER.toLowerCase()) { // Arbitrum WETH gateway
            const router = new Contract(
              ARBITRUM_GATEWAY_ROUTER,
              ['function l1TokenToGateway(address l1Token) view returns (address)'],
              await governanceDeploymentManager.getSigner()
            );
            return await router.l1TokenToGateway(l1Token);
          }
          return targets[i];
        })();
        const l2Gateway = new Contract(
          gatewayAddress,
          ['function counterpartGateway() view returns (address)'],
          await bridgeDeploymentManager.getSigner()
        );
        const l1GatewayAddress = await l2Gateway.counterpartGateway();

        const l1Gateway = new Contract(
          l1GatewayAddress,
          [
            'function finalizeInboundTransfer(address _token, address _from, address _to, uint256 _amount, bytes calldata _data)',
            'function inbox() view returns (address)'
          ],
          await governanceDeploymentManager.getSigner()
        );
        // override 0x4 slot in outbox to L2 gateway
        await governanceDeploymentManager.hre.network.provider.send('hardhat_setStorageAt', [
          ARBITRUM_OUTBOX,
          '0x4',
          utils.hexZeroPad(gatewayAddress, 32)
        ]);

        // impersonate outbox to call finalizeInboundTransfer, as if the message came from L2 gateway
        const outboxSigner = await impersonateAddress(
          governanceDeploymentManager,
          ARBITRUM_OUTBOX
        );

        await governanceDeploymentManager.hre.network.provider.send('hardhat_setBalance', [
          outboxSigner.address,
          '0x1000000000000000000',
        ]);

        const arbitrumBridge = new Contract(
          ARBITRUM_BRIDGE,
          ['function executeCall(address to, uint256 value, bytes calldata data)'],
          outboxSigner
        );

        const data = l1Gateway.interface.encodeFunctionData(
          'finalizeInboundTransfer',
          [
            l1Token,
            ARBITRUM_GATEWAY_ROUTER,
            to, amount,
            utils.defaultAbiCoder.encode(['uint256', 'bytes'], [0, '0x'])
          ]);
        console.log(`Relaying message to L1 gateway at ${l1GatewayAddress} with data: ${data}`);
        const bridgeTx = await arbitrumBridge.connect(outboxSigner).executeCall(
          l1Gateway.address,
          l1Token.toLowerCase() === MAINNET_WETH.toLowerCase() ? amount : 0,
          data,
        );
        await (bridgeTx).wait();
        // stop impersonation after the call
        await governanceDeploymentManager.hre.network.provider.send('hardhat_stopImpersonatingAccount', [
          outboxSigner.address
        ]);
        // override 0x4 slot in outbox to L2 gateway
        await governanceDeploymentManager.hre.network.provider.send('hardhat_setStorageAt', [
          ARBITRUM_OUTBOX,
          '0x4',
          utils.hexZeroPad(constants.AddressZero, 32)
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
      await governanceDeploymentManager.hre.network.provider.send('evm_mine');
    }
  }
}

export async function relayArbitrumCCTPMint(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  startingBlockNumber: number,
  tenderlyLogs?: any[]
){

  if(tenderlyLogs) {
    return;
  }
  // CCTP relay
  // L1 contracts
  const L1MessageTransmitter = await governanceDeploymentManager.getContractOrThrow('CCTPMessageTransmitter');
  // Arbitrum TokenMinter which is L2 contracts
  const TokenMinter = await bridgeDeploymentManager.existing('TokenMinter', '0xE7Ed1fa7f45D05C508232aa32649D89b73b8bA48', 'arbitrum');

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

  // Impersonate the Arbitrum TokenMinter and mint token to recipient
  const ImpersonateLocalTokenMessenger = bridgeDeploymentManager.network === 'arbitrum' ? '0x19330d10d9cc8751218eaf51e8885d058642e08a' : '0x0';
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
    if (tenderlyLogs) {
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