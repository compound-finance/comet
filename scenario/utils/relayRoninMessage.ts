import { DeploymentManager } from '../../plugins/deployment_manager';
import { impersonateAddress } from '../../plugins/scenario/utils';
import { setNextBaseFeeToZero, setNextBlockTimestamp } from './hreUtils';
import { BigNumber, ethers } from 'ethers';
import { Log } from '@ethersproject/abstract-provider';
import { OpenBridgedProposal } from '../context/Gov';

export default async function relayRoninMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  startingBlockNumber: number
) {
  const roninl1CCIPOnRamp = await governanceDeploymentManager.getContractOrThrow('roninl1CCIPOnRamp');
  const l2Router = (await bridgeDeploymentManager.getContractOrThrow('l2CCIPRouter'))
  const l2CCIPOffRamp = (await bridgeDeploymentManager.getContractOrThrow('l2CCIPOffRamp'))
  const bridgeReceiver = (await bridgeDeploymentManager.getContractOrThrow('bridgeReceiver'))

  const openBridgedProposals: OpenBridgedProposal[] = [];

  const filter = roninl1CCIPOnRamp.filters.CCIPSendRequested();
  const latestBlock = (await governanceDeploymentManager.hre.ethers.provider.getBlock('latest')).number;
  const logs: Log[] = await governanceDeploymentManager.hre.ethers.provider.getLogs({
    fromBlock: latestBlock - 500,
    toBlock: 'latest',
    address: roninl1CCIPOnRamp.address,
    topics: filter.topics || []
  });

  for (const log of logs) {
    const parsedLog = roninl1CCIPOnRamp.interface.parseLog(log);
    const internalMsg = parsedLog.args.message;

    console.log(`[CCIP L1->L2] Found CCIPSendRequested with messageId=${internalMsg.messageId}`);

    const offRampSigner = await impersonateAddress(bridgeDeploymentManager, l2CCIPOffRamp.address);

    await bridgeDeploymentManager.hre.network.provider.request({
      method: 'hardhat_setBalance',
      params: [l2CCIPOffRamp.address, '0x1000000000000000000000']
    });

    await setNextBaseFeeToZero(bridgeDeploymentManager);

    const any2EVMMessage = {
      messageId: internalMsg.messageId,
      sourceChainSelector: internalMsg.sourceChainSelector,
      sender: ethers.utils.defaultAbiCoder.encode(["address"], [internalMsg.sender]),
      data: internalMsg.data,
      destTokenAmounts: internalMsg.tokenAmounts.map((t: any) => ({
        token: t.token as string,
        amount: BigNumber.from(t.amount)
      })),
    };

    const routeTx = await l2Router
      .connect(offRampSigner)
      .routeMessage(
        any2EVMMessage,
        25_000,
        2_000_000,
        internalMsg.receiver,
      );

    const routeReceipt = await routeTx.wait();
    console.log(`[CCIP L2] routeMessage done, txHash=${routeTx.hash}`);

    const proposalCreatedEvent = routeReceipt.events?.find(
      (ev) =>
        ev.address.toLowerCase() === bridgeReceiver.address.toLowerCase() &&
        ev.topics[0] === bridgeReceiver.interface.getEventTopic('ProposalCreated')
    );
    if (proposalCreatedEvent) {
      const decoded = bridgeReceiver.interface.parseLog(proposalCreatedEvent);
      const { id, eta } = decoded.args;
      openBridgedProposals.push({ id, eta });
      console.log(`[CCIP L2] Queued proposal: id=${id.toString()}, eta=${eta.toString()}`);
    }
  }

  for (const proposal of openBridgedProposals) {
    const { id, eta } = proposal;
    await setNextBlockTimestamp(bridgeDeploymentManager, eta.toNumber() + 1);
    await setNextBaseFeeToZero(bridgeDeploymentManager);

    await bridgeReceiver.executeProposal(id, { gasPrice: 0 });
    console.log(`[CCIP L2] Executed bridged proposal ${id.toString()}`);
  }
}
