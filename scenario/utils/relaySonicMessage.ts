import { DeploymentManager } from '../../plugins/deployment_manager';
import { impersonateAddress } from '../../plugins/scenario/utils';
import { setNextBaseFeeToZero, setNextBlockTimestamp } from './hreUtils';
import { ethers } from 'ethers';
import { Log } from '@ethersproject/abstract-provider';

function applyL1ToL2Alias(address: string) {
  const offset = BigInt('0x1111000000000000000000000000000000001111');
  return `0x${(BigInt(address) + offset).toString(16)}`;
}

export default async function relaySonicMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  startingBlockNumber: number
) {
  const endpointOrigin = await governanceDeploymentManager.getContractOrThrow('LayerZeroEndpoint');
  const endpointDestination = await bridgeDeploymentManager.getContractOrThrow('LayerZeroEndpoint');
  const bridgeReceiver = await bridgeDeploymentManager.getContractOrThrow('bridgeReceiver');

  const openBridgedProposals: { id: ethers.BigNumber; eta: ethers.BigNumber }[] = [];

  const filter = endpointOrigin.filters.PacketSent();
  const sentPacketEvents: Log[] = await governanceDeploymentManager.hre.ethers.provider.getLogs({
    fromBlock: startingBlockNumber,
    toBlock: 'latest',
    address: endpointOrigin.address,
    topics: filter.topics!,
  });

  for (const sentPacketEvent of sentPacketEvents) {
    const { args: { encodedPayload, sendLibrary } } = endpointOrigin.interface.parseLog(sentPacketEvent);

    const decodedPayload = ethers.utils.defaultAbiCoder.decode(
      [
        'uint8', // PACKET_VERSION
        'uint64', // nonce
        'uint32', // srcEid
        'bytes32', // sender
        'uint32', // dstEid
        'address', // receiver
        'bytes32', // guid
        'bytes', // message
      ],
      encodedPayload
    );

    const packetVersion = decodedPayload[0];
    const nonce = decodedPayload[1];
    const srcEid = decodedPayload[2];
    const sender = ethers.utils.getAddress(decodedPayload[3].slice(26)); // Extract address from bytes32
    const dstEid = decodedPayload[4];
    const receiver = decodedPayload[5];
    const guid = decodedPayload[6];
    const message = decodedPayload[7];

    console.log(`Decoded Packet:`, { packetVersion, nonce, srcEid, sender, dstEid, receiver, guid, message });

    const aliasedSigner = await impersonateAddress(
      bridgeDeploymentManager,
      applyL1ToL2Alias(endpointOrigin.address)
    );

    await setNextBaseFeeToZero(bridgeDeploymentManager);

    const relayMessageTxn = await (
      await endpointDestination.connect(aliasedSigner).lzReceive(
        srcEid, 
        ethers.utils.hexlify(ethers.utils.zeroPad(endpointOrigin.address, 32)),
        nonce,
        encodedPayload, 
        { gasPrice: 0, gasLimit: 7_500_000 }
      )
    ).wait();

    if (receiver === bridgeReceiver.address) {
      const proposalCreatedEvent = relayMessageTxn.events.find(event => event.address === bridgeReceiver.address);
      const { args: { id, eta } } = bridgeReceiver.interface.parseLog(proposalCreatedEvent);
      openBridgedProposals.push({ id, eta });
    } else {
      console.log(`[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Relayed message to ${receiver}`);
    }
  }

  for (const proposal of openBridgedProposals) {
    const { eta, id } = proposal;
    await setNextBlockTimestamp(bridgeDeploymentManager, eta.toNumber() + 1);
    await setNextBaseFeeToZero(bridgeDeploymentManager);
    await bridgeReceiver.executeProposal(id, { gasPrice: 0 });
    console.log(`[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Executed bridged proposal ${id}`);
  }
}
