import { DeploymentManager } from '../../plugins/deployment_manager';
import { impersonateAddress } from '../../plugins/scenario/utils';
import { setNextBaseFeeToZero, setNextBlockTimestamp } from './hreUtils';
import { BigNumber, ethers } from 'ethers';
import { Log } from '@ethersproject/abstract-provider';
import { OpenBridgedProposal } from '../context/Gov';
import { isTenderlyLog, updateCCIPStats } from './index';

const roninChainSelector = '6916147374840168594';
const mainnetChainSelector = '5009297550715157269';

const MAINNET_CCIP_ROUTER = '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D';
const MAINNET_RONIN_OFF_RAMP = '0x9a3Ed7007809CfD666999e439076B4Ce4120528D';

export default async function relayRoninMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  startingBlockNumber: number,
  tenderlyLogs?: any[]
) {

  const l1CCIPOnRamp = await governanceDeploymentManager.getContractOrThrow('roninl1CCIPOnRamp');
  const l2Router = (await bridgeDeploymentManager.getContractOrThrow('l2CCIPRouter'));
  const l2CCIPOffRamp = (await bridgeDeploymentManager.getContractOrThrow('l2CCIPOffRamp'));
  const bridgeReceiver = (await bridgeDeploymentManager.getContractOrThrow('bridgeReceiver'));
  const l1TokenAdminRegistry = await governanceDeploymentManager.getContractOrThrow('l1TokenAdminRegistry');
  const timelockMainnet = await governanceDeploymentManager.getContractOrThrow('timelock');

  const l2TokenAdminRegistry = await bridgeDeploymentManager.existing(
    'l2TokenAdminRegistry',
    '0x90e83d532A4aD13940139c8ACE0B93b0DdbD323a',
    'ronin'
  );

  const l2CCIPOnRamp = await bridgeDeploymentManager.getContractOrThrow('l2CCIPOnRamp');
  const l1CCIPRouter = await governanceDeploymentManager.existing('l1CCIPRouter', MAINNET_CCIP_ROUTER, 'mainnet');
  const l1CCIPOffRamp = await governanceDeploymentManager.existing('roninl1CCIPOffRamp', MAINNET_RONIN_OFF_RAMP, 'mainnet');

  const offRampSigner = await impersonateAddress(bridgeDeploymentManager, l2CCIPOffRamp.address);
  const l1OffRampSigner = await impersonateAddress(governanceDeploymentManager, l1CCIPOffRamp.address);

  const openBridgedProposals: OpenBridgedProposal[] = [];

  const filterCCIP = l1CCIPOnRamp.filters.CCIPSendRequested();
  let logsCCIP: Log[] = [];

  if (tenderlyLogs) {
    const topic = l1CCIPOnRamp.interface.getEventTopic('CCIPSendRequested');
    const tenderlyEvents = tenderlyLogs.filter(
      log => log.raw?.topics?.[0] === topic && log.raw?.address?.toLowerCase() === l1CCIPOnRamp.address.toLowerCase()
    );
    const latestBlock = (await governanceDeploymentManager.hre.ethers.provider.getBlock('latest')).number;
    const realEvents = await governanceDeploymentManager.hre.ethers.provider.getLogs({
      fromBlock: latestBlock - 500,
      toBlock: 'latest',
      address: l1CCIPOnRamp.address,
      topics: filterCCIP.topics || []
    });
    logsCCIP = [...realEvents, ...tenderlyEvents];
  } else {
    const latestBlock = (await governanceDeploymentManager.hre.ethers.provider.getBlock('latest')).number;
    logsCCIP = await governanceDeploymentManager.hre.ethers.provider.getLogs({
      fromBlock: latestBlock - 500,
      toBlock: 'latest',
      address: l1CCIPOnRamp.address,
      topics: filterCCIP.topics || []
    });
  }

  let routeReceipt: { events: any[] };
  
  for (const log of logsCCIP) {
    let parsedLog;
    if (isTenderlyLog(log)) {
      parsedLog = l1CCIPOnRamp.interface.parseLog({
        topics: log.raw.topics,
        data: log.raw.data
      });
    } else {
      parsedLog = l1CCIPOnRamp.interface.parseLog(log);
    }
    
    const internalMsg = parsedLog.args.message;
    if (internalMsg.receiver.toLowerCase() !== bridgeReceiver.address.toLowerCase()) {
      console.log(`[CCIP L1->L2] Skipping message with receiver ${internalMsg.receiver} not matching bridgeReceiver ${bridgeReceiver.address}`);
      continue;
    }

    console.log(`[CCIP L1->L2] Found CCIPSendRequested with messageId=${internalMsg.messageId}`);

    await bridgeDeploymentManager.hre.network.provider.request({
      method: 'hardhat_setBalance',
      params: [offRampSigner.address, '0x1000000000000000000000']
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

    if (tenderlyLogs) {
      const callData = l2Router.interface.encodeFunctionData('routeMessage', [
        any2EVMMessage,
        25_000,
        10_000_000,
        internalMsg.receiver,
      ]);
      bridgeDeploymentManager.stashRelayMessage(
        l2Router.address,
        callData,
        offRampSigner.address
      );
      
      if (internalMsg.tokenAmounts.length) {
        for (const tokenTransferData of internalMsg.tokenAmounts) {
          const l1TokenPoolAddress = await l1TokenAdminRegistry.getPool(tokenTransferData.token);
          const l1TokenPool = new ethers.Contract(
            l1TokenPoolAddress,
            ['function getRemoteToken(uint64) external view returns (bytes)'],
            governanceDeploymentManager.hre.ethers.provider
          );
          const l2Token64 = await l1TokenPool.getRemoteToken(roninChainSelector);
          const l2TokenAddress = ethers.utils.defaultAbiCoder.decode(['address'], l2Token64)[0];
          const l2TokenPool = await l2TokenAdminRegistry.getPool(l2TokenAddress);
          
          const mintAmount = tokenTransferData.amount;
          const mintCallData = new ethers.utils.Interface([
            'function mint(address, uint256) external'
          ]).encodeFunctionData('mint', [internalMsg.receiver, mintAmount]);
          
          bridgeDeploymentManager.stashRelayMessage(
            l2TokenAddress,
            mintCallData,
            l2TokenPool
          );
        }
      }
    }
    const routeTx = await l2Router.connect(offRampSigner).routeMessage(
      any2EVMMessage,
      25_000,
      10_000_000,
      internalMsg.receiver,
    );

    routeReceipt = await routeTx.wait();

    if (internalMsg.tokenAmounts.length) {
      for (const tokenTransferData of internalMsg.tokenAmounts) {
        const l1TokenPoolAddress = await l1TokenAdminRegistry.getPool(tokenTransferData.token);
        const l1TokenPool = new ethers.Contract(
          l1TokenPoolAddress,
          ['function getRemoteToken(uint64) external view returns (bytes)'],
          governanceDeploymentManager.hre.ethers.provider
        );
        const l2Token64 = await l1TokenPool.getRemoteToken(roninChainSelector);
        const l2TokenAddress = ethers.utils.defaultAbiCoder.decode(['address'], l2Token64)[0];
        const l2TokenPool = await l2TokenAdminRegistry.getPool(l2TokenAddress);
        const l2Token = new ethers.Contract(
          l2TokenAddress,
          [
            'function balanceOf(address) external view returns (uint256)',
            'function mint(address, uint256) external',
            'function transfer(address, uint256) external'
          ],
          bridgeDeploymentManager.hre.ethers.provider
        );

        await bridgeDeploymentManager.hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [l2TokenPool]
        });

        const signer = await impersonateAddress(bridgeDeploymentManager, l2TokenPool);
        await bridgeDeploymentManager.hre.network.provider.request({
          method: 'hardhat_setBalance',
          params: [l2TokenPool, '0x1000000000000000000000']
        });

        const poolBalance = await l2Token.balanceOf(l2TokenPool);
        const mintAmount = tokenTransferData.amount.sub(poolBalance);
        if (mintAmount.lte(0)) {
          console.log(`[CCIP L1->L2] No mint needed for ${l2TokenAddress}`);
          const transferTx = await l2Token.connect(signer).transfer(internalMsg.receiver, tokenTransferData.amount);
          await transferTx.wait();
          console.log(`[CCIP L1->L2] Transferred ${tokenTransferData.amount.toString()} of ${l2TokenAddress} to ${internalMsg.receiver}`);
        } else {
          console.log(`[CCIP L1->L2] Minting ${mintAmount.toString()} of ${l2TokenAddress} to ${internalMsg.receiver}`);
          const mintTx = await l2Token.connect(signer).mint(internalMsg.receiver, mintAmount);
          await mintTx.wait();
          console.log(`[CCIP L1->L2] Minted ${mintAmount.toString()} of ${l2TokenAddress} to ${internalMsg.receiver}`);
        }
      }
    }

    console.log(`[CCIP L1->L2] Routed message to ${internalMsg.receiver}`);
  
    const proposalCreatedEvents = routeReceipt.events?.filter(
      (ev: ethers.Event) =>
        ev.address.toLowerCase() === bridgeReceiver.address.toLowerCase() &&
        ev.topics[0] === bridgeReceiver.interface.getEventTopic('ProposalCreated')
    ) || [];
  
    console.log(`[CCIP L2] Found proposalCreatedEvents: ${JSON.stringify(proposalCreatedEvents)}`);
    for (const proposalCreatedEvent of proposalCreatedEvents) {
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

    if (tenderlyLogs) {
      const callData = bridgeReceiver.interface.encodeFunctionData('executeProposal', [id]);
      await updateCCIPStats(bridgeDeploymentManager, tenderlyLogs);
      const signer = await bridgeDeploymentManager.getSigner();
      bridgeDeploymentManager.stashRelayMessage(
        bridgeReceiver.address,
        callData,
        await signer.getAddress()
      );
    } else {
      await updateCCIPStats(bridgeDeploymentManager);
      const signer = await bridgeDeploymentManager.getSigner();
      await bridgeReceiver.connect(signer).executeProposal(id, { gasPrice: 0 });
      console.log(`[CCIP L2] Executed bridged proposal ${id.toString()}`);
    }
  }
  if (tenderlyLogs) return openBridgedProposals;

  // Process L2→L1 (Ronin→Mainnet) messages
  const filterCCIPL2ToL1 = l2CCIPOnRamp.filters.CCIPSendRequested();
  let logsCCIPL2ToL1: Log[] = [];

  const latestBlock = (await bridgeDeploymentManager.hre.ethers.provider.getBlock('latest')).number;
  logsCCIPL2ToL1 = await bridgeDeploymentManager.hre.ethers.provider.getLogs({
    fromBlock: latestBlock - 500,
    toBlock: 'latest',
    address: l2CCIPOnRamp.address,
    topics: filterCCIPL2ToL1.topics || []
  });

  const targetReceivers = [
    timelockMainnet.address.toLowerCase()
  ];

  for (const log of logsCCIPL2ToL1) {
    const parsedLog = l2CCIPOnRamp.interface.parseLog(log);

    const internalMsg = parsedLog.args.message;
    if (!targetReceivers.includes(internalMsg.receiver.toLowerCase())) continue;
    console.log(`[CCIP L2->L1] Found CCIPSendRequested with messageId=${internalMsg.messageId}, receiver=${internalMsg.receiver}`);

    await governanceDeploymentManager.hre.network.provider.request({
      method: 'hardhat_setBalance',
      params: [l1CCIPOffRamp.address, '0x1000000000000000000000']
    });

    await setNextBaseFeeToZero(governanceDeploymentManager);

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

    const routeTx = await l1CCIPRouter.connect(l1OffRampSigner).routeMessage(
      any2EVMMessage,
      25_000,
      2_000_000,
      internalMsg.receiver,
    );

    await routeTx.wait();

    if (internalMsg.tokenAmounts.length) {
      for (const tokenTransferData of internalMsg.tokenAmounts) {
        const l2TokenPoolAddress = await l2TokenAdminRegistry.getPool(tokenTransferData.token);
        const l2TokenPool = new ethers.Contract(
          l2TokenPoolAddress,
          ['function getRemoteToken(uint64) external view returns (bytes)'],
          bridgeDeploymentManager.hre.ethers.provider
        );
        const l1Token64 = await l2TokenPool.getRemoteToken(mainnetChainSelector);
        const l1TokenAddress = ethers.utils.defaultAbiCoder.decode(['address'], l1Token64)[0];
        const l1TokenPool = await l1TokenAdminRegistry.getPool(l1TokenAddress);
        const l1Token = new ethers.Contract(
          l1TokenAddress,
          [
            'function balanceOf(address) external view returns (uint256)',
            'function transfer(address, uint256) external returns (bool)'
          ],
          governanceDeploymentManager.hre.ethers.provider
        );

        const poolSigner = await impersonateAddress(governanceDeploymentManager, l1TokenPool);
        await governanceDeploymentManager.hre.network.provider.request({
          method: 'hardhat_setBalance',
          params: [l1TokenPool, '0x1000000000000000000000']
        });

        const poolBalance = await l1Token.balanceOf(l1TokenPool);
        console.log(`[CCIP L2->L1] Token pool ${l1TokenPool} balance: ${poolBalance.toString()}, transferring ${tokenTransferData.amount.toString()} to ${internalMsg.receiver}`);

        const transferTx = await l1Token.connect(poolSigner).transfer(internalMsg.receiver, tokenTransferData.amount);
        await transferTx.wait();
        console.log(`[CCIP L2->L1] Transferred ${tokenTransferData.amount.toString()} of ${l1TokenAddress} to ${internalMsg.receiver}`);
      }
    }

    console.log(`[CCIP L2->L1] Routed message to ${internalMsg.receiver}`);
  }

  return openBridgedProposals;
}