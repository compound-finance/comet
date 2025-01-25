import { DeploymentManager } from '../../plugins/deployment_manager';
import { impersonateAddress } from '../../plugins/scenario/utils';
import { setNextBaseFeeToZero, setNextBlockTimestamp } from './hreUtils';
import { BigNumber, ethers } from 'ethers';
import { Log } from '@ethersproject/abstract-provider';
import { OpenBridgedProposal } from '../context/Gov';

// interface IEVM2EVMOnRamp extends ethers.Contract {
//   filters: {
//     CCIPSendRequested(): ethers.EventFilter;
//   };
//   interface: ethers.utils.Interface;
// }

// interface IRouter extends ethers.Contract {
//   filters: {
//     MessageExecuted(): ethers.EventFilter;
//   };
//   interface: ethers.utils.Interface;
//   routeMessage(
//     message: {
//       messageId: string;
//       sourceChainSelector: number;
//       sender: string;
//       data: string;
//       destTokenAmounts: {
//         token: string;
//         amount: BigNumber;
//       }[];
//     },
//     gasForCallExactCheck: number,
//     gasLimit: number,
//     receiver: string
//   ): Promise<ethers.ContractTransaction>;
// }

// interface IBridgeReceiver extends ethers.Contract {
//   interface: ethers.utils.Interface;
//   executeProposal: (id: BigNumber, overrides?: any) => Promise<ethers.ContractTransaction>;
// }


// const offRampAddress = '0x77008Fbd8Ae8f395beF9c6a55905896f3Ead75e9';

export default async function relayRoninSaigonMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  startingBlockNumber: number
) {
  const roninSaigonl1CCIPOnRamp = await governanceDeploymentManager.getContractOrThrow('roninSaigonl1CCIPOnRamp');
  const l2Router = (await bridgeDeploymentManager.getContractOrThrow('l2CCIPRouter'))
  const l2CCIPOffRamp = (await bridgeDeploymentManager.getContractOrThrow('l2CCIPOffRamp'))
  const bridgeReceiver = (await bridgeDeploymentManager.getContractOrThrow('bridgeReceiver'))// as IBridgeReceiver;

  const openBridgedProposals: OpenBridgedProposal[] = [];

  const filter = roninSaigonl1CCIPOnRamp.filters.CCIPSendRequested();
  const logs: Log[] = await governanceDeploymentManager.hre.ethers.provider.getLogs({
    fromBlock: startingBlockNumber,
    toBlock: 'latest',
    address: roninSaigonl1CCIPOnRamp.address,
    topics: filter.topics || []
  });

  for (const log of logs) {
    const parsedLog = roninSaigonl1CCIPOnRamp.interface.parseLog(log);
    const internalMsg = parsedLog.args.message;

    console.log(`[CCIP L1->L2] Found CCIPSendRequested with messageId=${internalMsg.messageId}`);

    const offRampSigner = await impersonateAddress(bridgeDeploymentManager, l2CCIPOffRamp.address);

    await setNextBaseFeeToZero(bridgeDeploymentManager);

    const any2EVMMessage = {
      messageId: internalMsg.messageId,
      sourceChainSelector: internalMsg.sourceChainSelector.toNumber(),
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
        bridgeReceiver.address
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
