import { DeploymentManager } from '../../plugins/deployment_manager';
import { impersonateAddress } from '../../plugins/scenario/utils';
import { executeBridgedProposal } from './bridgeProposal';
import { setNextBaseFeeToZero } from './hreUtils';
import { Contract, ethers } from 'ethers';
import { Log } from '@ethersproject/abstract-provider';
import {OpenBridgedProposal} from '../context/Gov';


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
  startingBlockNumber: number
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

  // grab all events on the StateSender contract since the `startingBlockNumber`
  const filter = stateSender.filters.StateSynced();
  const stateSyncedEvents: Log[] = await governanceDeploymentManager.hre.ethers.provider.getLogs({
    fromBlock: startingBlockNumber,
    toBlock: 'latest',
    address: stateSender.address,
    topics: filter.topics!
  });

  for (let stateSyncedEvent of stateSyncedEvents) {
    const {
      args: { data: stateSyncedData }
    } = stateSender.interface.parseLog(stateSyncedEvent);

    // Try to decode the StateSynced data to determine what type of cross-chain activity this is. So far,
    // there are two types:
    // 1. Bridging ERC20 token
    // 2. Cross-chain message passing
    const maybeBridgeERC20Data = tryDecodeStateSyncedData(stateSyncedData);
    if (maybeBridgeERC20Data !== undefined) {
      // Bridging ERC20 token
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
      await(
        await childChainManager.connect(polygonReceiverSigner).onStateReceive(
          123, // stateId
          data, // data
          { gasPrice: 0 }
        )
      ).wait();

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
      const onStateReceiveTxn = await(
        await fxChild.connect(polygonReceiverSigner).onStateReceive(
          123, // stateId
          stateSyncedData, // _data
          { gasPrice: 0 }
        )
      ).wait();

      const proposalCreatedEvent = onStateReceiveTxn.events.find(
        event => event.address === bridgeReceiver.address
      );
      const { args } = bridgeReceiver.interface.parseLog(proposalCreatedEvent);
      const proposal = args as unknown as OpenBridgedProposal;
      await executeBridgedProposal(bridgeDeploymentManager, proposal);
      console.log(
        `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Executed bridged proposal ${proposal.id}`
      );
    }
  }
}