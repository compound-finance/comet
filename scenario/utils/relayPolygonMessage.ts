import { DeploymentManager } from '../../plugins/deployment_manager';
import { impersonateAddress } from '../../plugins/scenario/utils';
import { executeBridgedProposal } from './bridgeProposal';
import { setNextBaseFeeToZero } from './hreUtils';
import { Contract, ethers } from 'ethers';
import { Log } from '@ethersproject/abstract-provider';
import { OpenBridgedProposal } from '../context/Gov';

function isTenderlyLog(log: any): log is { raw: { topics: string[], data: string } } {
  return !!log?.raw?.topics && !!log?.raw?.data;
}

type BridgeERC20Data = {
  syncData: string;
  user: string;
  rootToken: string;
  amount: bigint;
};

function tryDecodeStateSyncedData(stateSyncedData: any): BridgeERC20Data | undefined {
  try {
    const { syncData } = ethers.utils.defaultAbiCoder.decode(
      ['bytes32', 'bytes syncData'],
      stateSyncedData
    );
    const { user, rootToken, depositData } = ethers.utils.defaultAbiCoder.decode(
      ['address user', 'address rootToken', 'bytes depositData'],
      syncData
    );
    const { amount } = ethers.utils.defaultAbiCoder.decode(['uint256 amount'], depositData);
    return {
      syncData,
      user,
      rootToken,
      amount
    };
  } catch (e) {
    return undefined;
  }
}

export default async function relayPolygonMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  startingBlockNumber: number,
  tenderlyLogs?: any[]
) {
  const POLYGON_RECEIVER_ADDRESSS = '0x0000000000000000000000000000000000001001';
  const childChainManagerProxyAddress =
    bridgeDeploymentManager.network === 'polygon'
      ? '0xA6FA4fB5f76172d178d61B04b0ecd319C5d1C0aa'
      : '0xb5505a6d998549090530911180f38aC5130101c6';

  const stateSender = await governanceDeploymentManager.getContractOrThrow('stateSender');
  const bridgeReceiver = await bridgeDeploymentManager.getContractOrThrow('bridgeReceiver');
  const fxChild = await bridgeDeploymentManager.getContractOrThrow('fxChild');
  const childChainManager = new Contract(
    childChainManagerProxyAddress,
    [
      'function rootToChildToken(address rootToken) public view returns (address)',
      'function onStateReceive(uint256, bytes calldata data) external',
      'function DEPOSIT() public view returns (bytes32)'
    ],
    bridgeDeploymentManager.hre.ethers.provider
  );

  const openBridgedProposals: OpenBridgedProposal[] = [];

  const filter = stateSender.filters.StateSynced();
  let stateSyncedEvents: Log[] = [];

  if (tenderlyLogs) {
    const topic = stateSender.interface.getEventTopic('StateSynced');
    const tenderlyEvents = tenderlyLogs.filter(
      log => log.raw?.topics?.[0] === topic && log.raw?.address?.toLowerCase() === stateSender.address.toLowerCase()
    );
    const realEvents = await governanceDeploymentManager.hre.ethers.provider.getLogs({
      fromBlock: startingBlockNumber,
      toBlock: 'latest',
      address: stateSender.address,
      topics: filter.topics!
    });
    stateSyncedEvents = [...realEvents, ...tenderlyEvents];
  } else {
    stateSyncedEvents = await governanceDeploymentManager.hre.ethers.provider.getLogs({
      fromBlock: startingBlockNumber,
      toBlock: 'latest',
      address: stateSender.address,
      topics: filter.topics!
    });
  }

  for (const stateSyncedEvent of stateSyncedEvents) {
    let parsed;
    if (isTenderlyLog(stateSyncedEvent)) {
      parsed = stateSender.interface.parseLog({
        topics: stateSyncedEvent.raw.topics,
        data: stateSyncedEvent.raw.data
      });
    } else {
      parsed = stateSender.interface.parseLog(stateSyncedEvent);
    }
    // Try to decode the StateSynced data to determine what type of cross-chain activity this is. So far,
    // there are two types:
    // 1. Bridging ERC20 token
    // 2. Cross-chain message passing

    const { data: stateSyncedData } = parsed.args;

    const maybeBridgeERC20Data = tryDecodeStateSyncedData(stateSyncedData);

    if (maybeBridgeERC20Data !== undefined) {
      const depositSyncType = await childChainManager.DEPOSIT();
      const data = ethers.utils.defaultAbiCoder.encode(
        ['bytes32', 'bytes'],
        [depositSyncType, maybeBridgeERC20Data.syncData]
      );
      const polygonReceiverSigner = await impersonateAddress(
        bridgeDeploymentManager,
        POLYGON_RECEIVER_ADDRESSS
      );
      await setNextBaseFeeToZero(bridgeDeploymentManager);

      if (tenderlyLogs) {
        const callData = childChainManager.interface.encodeFunctionData('onStateReceive', [123, data]);
        const signer = await bridgeDeploymentManager.getSigner();
        bridgeDeploymentManager.stashRelayMessage(
          childChainManager.address,
          callData,
          signer.address
        );
      } else {
        await(
          await childChainManager.connect(polygonReceiverSigner).onStateReceive(
            123, // stateId
            data, // data
            { gasPrice: 0 }
          )
        ).wait();
      }
      console.log(
        `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Bridged over ${maybeBridgeERC20Data.amount} of ${maybeBridgeERC20Data.rootToken} to user ${maybeBridgeERC20Data.user}`
      );
    } else {
      // Cross-chain message passing
      const polygonReceiverSigner = await impersonateAddress(
        bridgeDeploymentManager,
        POLYGON_RECEIVER_ADDRESSS
      );

      await setNextBaseFeeToZero(bridgeDeploymentManager);

      if (tenderlyLogs) {
        const callData = fxChild.interface.encodeFunctionData('onStateReceive', [123, stateSyncedData]);
        bridgeDeploymentManager.stashRelayMessage(
          fxChild.address,
          callData,
          polygonReceiverSigner.address
        );
      }
      const onStateReceiveTxn = await (
        await fxChild.connect(polygonReceiverSigner).onStateReceive(
          123, // stateId
          stateSyncedData, // _data
          { gasPrice: 0 }
        )
      ).wait();

      const proposalCreatedEvent = onStateReceiveTxn.events.find(
        event => event.address === bridgeReceiver.address
      );
      const { args: { id, eta } } = bridgeReceiver.interface.parseLog(proposalCreatedEvent);
      
      openBridgedProposals.push({ id, eta });
      if (tenderlyLogs) {
        const signer = await bridgeDeploymentManager.getSigner();
        const callData = bridgeReceiver.interface.encodeFunctionData('executeProposal', [id]);
        bridgeDeploymentManager.stashRelayMessage(
          bridgeReceiver.address,
          callData,
          await signer.getAddress()
        );
      }
      else {
        await executeBridgedProposal(bridgeDeploymentManager, { id, eta });
      }
      console.log(
        `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Executed bridged proposal ${id}`
      );
    }
  }

  return openBridgedProposals;
}