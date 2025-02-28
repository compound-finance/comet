import { DeploymentManager } from '../../plugins/deployment_manager';
import { impersonateAddress } from '../../plugins/scenario/utils';
import { setNextBaseFeeToZero, setNextBlockTimestamp } from './hreUtils';
import { BigNumber, ethers } from 'ethers';
import { Log } from '@ethersproject/abstract-provider';
import { OpenBridgedProposal } from '../context/Gov';

const MINTER = '0xA6F175104fAAa5C1b034fB82c98bd674e3C6E7d7';

export default async function relayRoninMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  _
) {
  const l1CCIPOnRamp = await governanceDeploymentManager.getContractOrThrow('roninl1CCIPOnRamp');
  const l2Router = (await bridgeDeploymentManager.getContractOrThrow('l2CCIPRouter'));
  const l2CCIPOffRamp = (await bridgeDeploymentManager.getContractOrThrow('l2CCIPOffRamp'));
  const bridgeReceiver = (await bridgeDeploymentManager.getContractOrThrow('bridgeReceiver'));
  const l1NativeBridge = (await governanceDeploymentManager.getContractOrThrow('roninl1NativeBridge'));
  const l2NativeBridge = (await bridgeDeploymentManager.getContractOrThrow('roninl2NativeBridge'));
  const offRampSigner = await impersonateAddress(bridgeDeploymentManager, l2CCIPOffRamp.address);

  const openBridgedProposals: OpenBridgedProposal[] = [];

  const filterCCIP = l1CCIPOnRamp.filters.CCIPSendRequested();
  const filterNative = l1NativeBridge.filters.DepositRequested();
  const latestBlock = (await governanceDeploymentManager.hre.ethers.provider.getBlock('latest')).number;
  const logsCCIP: Log[] = await governanceDeploymentManager.hre.ethers.provider.getLogs({
    fromBlock: latestBlock - 500,
    toBlock: 'latest',
    address: l1CCIPOnRamp.address,
    topics: filterCCIP.topics || []
  });
  const logsNativeBridge: Log[] = await governanceDeploymentManager.hre.ethers.provider.getLogs({
    fromBlock: latestBlock - 500,
    toBlock: 'latest',
    address: l1NativeBridge.address,
    topics: filterNative.topics || []
  });

  let routeReceipt;
  let routeTx;
  let bridgeTx;
  for (const log of logsCCIP) {
    const parsedLog = l1CCIPOnRamp.interface.parseLog(log);
    const internalMsg = parsedLog.args.message;

    console.log(`[CCIP L1->L2] Found CCIPSendRequested with messageId=${internalMsg.messageId}`);

    await bridgeDeploymentManager.hre.network.provider.request({
      method: 'hardhat_setBalance',
      params: [l2CCIPOffRamp.address, '0x1000000000000000000000']
    });

    await setNextBaseFeeToZero(bridgeDeploymentManager);
    const any2EVMMessage = {
      messageId: internalMsg.messageId,
      sourceChainSelector: internalMsg.sourceChainSelector,
      sender: ethers.utils.defaultAbiCoder.encode(['address'], [internalMsg.sender]),
      data: internalMsg.data,
      destTokenAmounts: internalMsg.tokenAmounts.map((t: any) => ({
        token: t.token as string,
        amount: BigNumber.from(t.amount)
      })),
    };

    routeTx = await l2Router
      .connect(offRampSigner)
      .routeMessage(
        any2EVMMessage,
        25_000,
        2_000_000,
        internalMsg.receiver,
      );

    routeReceipt = await routeTx.wait();

    await bridgeDeploymentManager.hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [MINTER]
    });

    await impersonateAddress(bridgeDeploymentManager, MINTER);

    if (internalMsg.tokenAmounts.length) {
      const mintSigner = await bridgeDeploymentManager.getSigner(MINTER);
      const mintSelector = ethers.utils.id('mint(address,uint256)').slice(0, 10);
      for (const tokenTransferData of internalMsg.tokenAmounts) {
        const encodedData = mintSelector + tokenTransferData.token.slice(2).padStart(64, '0') + tokenTransferData.amount.toHexString().slice(2).padStart(64, '0');
        const mintTx = await mintSigner.sendTransaction({
          to: tokenTransferData.token,
          data: encodedData
        });
        await mintTx.wait();
      }
    }

    console.log(`[CCIP L1->L2] Routed message to ${internalMsg.receiver}`);
  }


  for (const log of logsNativeBridge) {
    console.log(`[Native L1->L2] Found DepositRequested`);
    const parsedLog = l1NativeBridge.interface.parseLog(log);
    const internalMsg = parsedLog.args.receipt;

    await bridgeDeploymentManager.hre.network.provider.request({
      method: 'hardhat_setBalance',
      params: [l2NativeBridge.address, '0x1000000000000000000000']
    });

    await setNextBaseFeeToZero(bridgeDeploymentManager);

    const bridgeSigner = await impersonateAddress(bridgeDeploymentManager, l2NativeBridge.address);

    const transferSelector = ethers.utils.id('transfer(address,uint256)').slice(0, 10);
    const encodedData = transferSelector + ethers.utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [internalMsg.ronin.addr, internalMsg.info.quantity]
    ).slice(2);

    bridgeTx = await bridgeSigner.sendTransaction({
      to: internalMsg.ronin.tokenAddr,
      data: encodedData
    });

    console.log(`[Native L1->L2] Deposited ${internalMsg.info.quantity} to ${internalMsg.ronin.addr} of token ${internalMsg.ronin.tokenAddr}`);
    await bridgeTx.wait();
  }

  const proposalCreatedEvent = routeReceipt.events?.find(
    (ev) =>
      ev.address.toLowerCase() === bridgeReceiver.address.toLowerCase() &&
      ev.topics[0] === bridgeReceiver.interface.getEventTopic('ProposalCreated')
  );

  console.log(`[CCIP L2] Found proposalCreatedEvent: ${JSON.stringify(proposalCreatedEvent)}`);
  if (proposalCreatedEvent) {
    const decoded = bridgeReceiver.interface.parseLog(proposalCreatedEvent);
    const { id, eta } = decoded.args;
    openBridgedProposals.push({ id, eta });
    console.log(`[CCIP L2] Queued proposal: id=${id.toString()}, eta=${eta.toString()}`);
  }

  for (const proposal of openBridgedProposals) {
    const { id, eta } = proposal;
    await setNextBlockTimestamp(bridgeDeploymentManager, eta.toNumber() + 1);
    await setNextBaseFeeToZero(bridgeDeploymentManager);

    await bridgeReceiver.executeProposal(id, { gasPrice: 0 });
    console.log(`[CCIP L2] Executed bridged proposal ${id.toString()}`);
  }
}
