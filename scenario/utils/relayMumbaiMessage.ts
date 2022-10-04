import { DeploymentManager } from '../../plugins/deployment_manager';
import { impersonateAddress } from '../../plugins/scenario/utils';
import { setNextBaseFeeToZero, setNextBlockTimestamp } from './hreUtils';
import { Event } from 'ethers';

export default async function relayMumbaiMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
) {
  const MUMBAI_RECEIVER_ADDRESSS = '0x0000000000000000000000000000000000001001';
  const EVENT_LISTENER_TIMEOUT = 60000;

  const stateSender = await governanceDeploymentManager.getContractOrThrow('stateSender');
  const bridgeReceiver = await bridgeDeploymentManager.getContractOrThrow('bridgeReceiver');
  const fxChild = await bridgeDeploymentManager.getContractOrThrow('fxChild');

  // listen on events on the fxRoot contract
  const stateSyncedListenerPromise = new Promise((resolve, reject) => {
    const filter = stateSender.filters.StateSynced();

    governanceDeploymentManager.hre.ethers.provider.on(filter, (log) => {
      resolve(log);
    });

    setTimeout(() => {
      reject(new Error('StateSender.StateSynced event listener timed out'));
    }, EVENT_LISTENER_TIMEOUT);
  });

  const stateSyncedEvent = await stateSyncedListenerPromise as Event;
  const { args: { data: stateSyncedData } } = stateSender.interface.parseLog(stateSyncedEvent);

  const mumbaiReceiverSigner = await impersonateAddress(bridgeDeploymentManager, MUMBAI_RECEIVER_ADDRESSS);

  await setNextBaseFeeToZero(bridgeDeploymentManager);
  const onStateReceiveTxn = await (
    await fxChild.connect(mumbaiReceiverSigner).onStateReceive(
      123,             // stateId
      stateSyncedData, // _data
      { gasPrice: 0 }
    )
  ).wait();

  const proposalCreatedEvent = onStateReceiveTxn.events.find(event => event.address === bridgeReceiver.address);
  const { args: { id, eta } } = bridgeReceiver.interface.parseLog(proposalCreatedEvent);

  // fast forward l2 time
  await setNextBlockTimestamp(bridgeDeploymentManager, eta.toNumber() + 1);

  // execute queued proposal
  await setNextBaseFeeToZero(bridgeDeploymentManager);
  await bridgeReceiver.executeProposal(id, { gasPrice: 0 });
}