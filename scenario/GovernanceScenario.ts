import { scenario, setNextBaseFeeToZero, setNextBlockTimestamp, fastGovernanceExecute } from './context/CometContext';
import { expect } from 'chai';
import { BigNumberish, constants, Contract, EventFilter, utils } from 'ethers';
import { COMP_WHALES } from "../src/deploy";
import { impersonateAddress } from '../plugins/scenario/World';
import { importContract } from '../plugins/deployment_manager/Import';
import { DeploymentManager } from '../plugins/deployment_manager';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { isBridgedDeployment } from './utils';

const FX_ROOT_GOERLI = '0x3d1d3E34f7fB6D26245E6640E1c50710eFFf15bA';
const STATE_SENDER = '0xeaa852323826c71cd7920c3b4c007184234c3945';
const MUMBAI_RECEIVER_ADDRESSS = '0x0000000000000000000000000000000000001001';
const EVENT_LISTENER_TIMEOUT = 60000;

async function relayMumbaiMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
) {
  const l2Timelock = await bridgeDeploymentManager.contract('timelock');
  if (!l2Timelock) {
    throw new Error("deployment missing timelock");
  }
  const bridgeReceiver = await bridgeDeploymentManager.contract('bridgeReceiver');
  if (!bridgeReceiver) {
    throw new Error("deployment missing bridge receiver");
  }

  // listen on events on the fxRoot
  const stateSyncedListenerPromise = new Promise(async (resolve, reject) => {
    const filter: EventFilter = {
      address: STATE_SENDER,
      topics: [
        utils.id("StateSynced(uint256,address,bytes)")
      ]
    }

    governanceDeploymentManager.hre.ethers.provider.on(filter, (log) => {
      resolve(log);
    });

    setTimeout(() => {
      reject(new Error('StateSender.StateSynced event listener timed out'));
    }, EVENT_LISTENER_TIMEOUT);
  });

  // XXX type for stateSyncedEvent
  const stateSyncedEvent: any = await stateSyncedListenerPromise;

  const stateSenderInterface = new utils.Interface([
    "event StateSynced(uint256 indexed id, address indexed contractAddress, bytes data)"
  ]);

  const { contractAddress, data: stateSyncedData } = stateSenderInterface.decodeEventLog(
    "StateSynced",
    stateSyncedEvent.data,
    stateSyncedEvent.topics
  );

  const fxChildBuildFile = await importContract('mumbai', contractAddress);
  // XXX better way to construct this contract?
  const fxChildContract = new Contract(
    fxChildBuildFile.contracts["contracts/FxChild.sol:FxChild"].address as string,
    fxChildBuildFile.contracts["contracts/FxChild.sol:FxChild"].abi as string
  );

  const mumbaiReceiverSigner = await impersonateAddress(bridgeDeploymentManager, MUMBAI_RECEIVER_ADDRESSS);

  await setNextBaseFeeToZero(bridgeDeploymentManager);
  // function onStateReceive(uint256 stateId, bytes calldata _data)
  const onStateReceiveTxn = await (
    await fxChildContract.connect(mumbaiReceiverSigner).onStateReceive(
      123,  // stateId
      stateSyncedData, // _data
      { gasPrice: 0 }
    )
  ).wait();

  // pull the queue transaction event off of processMessageFromRootTxn
  const queueTransactionEvent = onStateReceiveTxn.events.find(event => event.address === l2Timelock?.address);
  const { target, value, signature, data, eta } = l2Timelock.interface.decodeEventLog(
    "QueueTransaction",
    queueTransactionEvent.data,
    queueTransactionEvent.topics
  );

  // fast forward l2 time
  await setNextBlockTimestamp(bridgeDeploymentManager, eta.toNumber() + 1);

  // execute queued transaction
  await setNextBaseFeeToZero(bridgeDeploymentManager);
  await bridgeReceiver.executeTransaction(
    target,
    value,
    signature,
    data,
    eta,
    { gasPrice: 0 }
  );
}

async function fastL2GovernanceExecute(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  proposer: SignerWithAddress,
  targets: string[],
  values: BigNumberish[],
  signatures: string[],
  calldatas: string[]
) {
  // execute mainnet governance proposal
  await fastGovernanceExecute(
    governanceDeploymentManager,
    proposer,
    targets,
    values,
    signatures,
    calldatas
  );

  const bridgeNetwork = bridgeDeploymentManager.network;
  switch (bridgeNetwork) {
    case 'mumbai':
      await relayMumbaiMessage(governanceDeploymentManager, bridgeDeploymentManager);
      break;
    default:
      throw new Error(`No governance execution strategy for network: ${bridgeNetwork}`);
  }
}

scenario(
  'execute Mumbai governance proposal',
  {
    filter: async (ctx) => ctx.world.network === 'mumbai'
  },
  async (_properties, _context, world) => {
    const governanceDeploymentManager = world.auxiliaryDeploymentManager;
    if (!governanceDeploymentManager) {
      throw new Error("cannot execute governance without governance deployment manager");
    }

    const l2Timelock = await world.deploymentManager.contract('timelock');
    if (!l2Timelock) {
      throw new Error("deployment missing timelock");
    }

    const bridgeReceiver = await world.deploymentManager.contract('bridgeReceiver');

    // l2 proposal
    const fiveDaysInSeconds = 5 * 24 * 60 * 60;
    const encodedL2Data = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [l2Timelock?.address],
        [0],
        ["setDelay(uint256)"],
        [
          utils.defaultAbiCoder.encode(['uint'], [fiveDaysInSeconds])
        ]
      ]
    );

    // l1 proposal -> fxRoot.sendMessageToChild(fxChildTunnel, l2Data)
    const sendMessageToChildCalldata = utils.defaultAbiCoder.encode(
      ['address', 'bytes'],
      [bridgeReceiver?.address, encodedL2Data]
    );

    const bridgeDeploymentManager = world.deploymentManager;
    const proposer = await impersonateAddress(governanceDeploymentManager, COMP_WHALES[0]);

    // check delay before
    console.log(`await l2Timelock?.delay(): ${await l2Timelock?.delay()}`);
    expect(await l2Timelock?.delay()).to.eq(2 * 24 * 60 * 60);

    await fastL2GovernanceExecute(
      governanceDeploymentManager,
      bridgeDeploymentManager,
      proposer,
      [FX_ROOT_GOERLI],
      [0],
      ["sendMessageToChild(address,bytes)"],
      [sendMessageToChildCalldata]
    );

    // check delay after
    console.log(`await l2Timelock?.delay(): ${await l2Timelock?.delay()}`);
    expect(await l2Timelock?.delay()).to.eq(fiveDaysInSeconds);
  }
);

scenario(
  'upgrade Comet implementation and initialize',
  {
    filter: async (ctx) => !isBridgedDeployment(ctx)
  },
  async ({ comet, configurator, proxyAdmin }, context, world) => {
    // For this scenario, we will be using the value of LiquidatorPoints.numAbsorbs for address ZERO to test that initialize has been called
    expect((await comet.liquidatorPoints(constants.AddressZero)).numAbsorbs).to.be.equal(0);

    // Deploy new version of Comet Factory
    const dm = world.deploymentManager;
    const cometModifiedFactory = await dm.deploy('cometFactory', 'test/CometModifiedFactory.sol', [], true);

    // Execute a governance proposal to:
    // 1. Set the new factory address in Configurator
    // 2. Deploy and upgrade to the new implementation of Comet
    // 3. Call initialize(address) on the new version of Comet
    const setFactoryCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [comet.address, cometModifiedFactory.address]);
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [configurator.address, comet.address]);
    const initializeCalldata = utils.defaultAbiCoder.encode(['address'], [constants.AddressZero]);
    await context.fastGovernanceExecute(
      [configurator.address, proxyAdmin.address, comet.address],
      [0, 0, 0],
      ['setFactory(address,address)', 'deployAndUpgradeTo(address,address)', 'initialize(address)'],
      [setFactoryCalldata, deployAndUpgradeToCalldata, initializeCalldata]
    );

    // LiquidatorPoints.numAbsorbs for address ZERO should now be set as UInt32.MAX
    expect((await comet.liquidatorPoints(constants.AddressZero)).numAbsorbs).to.be.equal(2 ** 32 - 1);
  }
);

scenario(
  'upgrade Comet implementation and initialize using deployUpgradeToAndCall',
  {
    filter: async (ctx) => !isBridgedDeployment(ctx)
  },
  async ({ comet, configurator, proxyAdmin }, context, world) => {
    // For this scenario, we will be using the value of LiquidatorPoints.numAbsorbs for address ZERO to test that initialize has been called
    expect((await comet.liquidatorPoints(constants.AddressZero)).numAbsorbs).to.be.equal(0);

    // Deploy new version of Comet Factory
    const dm = world.deploymentManager;
    const cometModifiedFactory = await dm.deploy(
      'cometFactory',
      'test/CometModifiedFactory.sol',
      [],
      true
    );

    // Execute a governance proposal to:
    // 1. Set the new factory address in Configurator
    // 2. DeployUpgradeToAndCall the new implementation of Comet
    const setFactoryCalldata = utils.defaultAbiCoder.encode(["address", "address"], [comet.address, cometModifiedFactory.address]);
    const modifiedComet = (await dm.hre.ethers.getContractFactory('CometModified')).attach(comet.address);
    const initializeCalldata = (await modifiedComet.populateTransaction.initialize(constants.AddressZero)).data;
    const deployUpgradeToAndCallCalldata = utils.defaultAbiCoder.encode(["address", "address", "bytes"], [configurator.address, comet.address, initializeCalldata]);

    await context.fastGovernanceExecute(
      [configurator.address, proxyAdmin.address],
      [0, 0],
      ["setFactory(address,address)", "deployUpgradeToAndCall(address,address,bytes)"],
      [setFactoryCalldata, deployUpgradeToAndCallCalldata]
    );

    // LiquidatorPoints.numAbsorbs for address ZERO should now be set as UInt32.MAX
    expect((await comet.liquidatorPoints(constants.AddressZero)).numAbsorbs).to.be.equal(2 ** 32 - 1);
  }
);

scenario(
  'upgrade Comet implementation and call new function',
  {
    filter: async (ctx) => !isBridgedDeployment(ctx)
  },
  async ({ comet, configurator, proxyAdmin, actors }, context, world) => {
    const { signer } = actors;

    // Deploy new version of Comet Factory
    const dm = world.deploymentManager;
    const cometModifiedFactory = await dm.deploy('cometFactory', 'test/CometModifiedFactory.sol', [], true);

    // Upgrade Comet implementation
    const setFactoryCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [comet.address, cometModifiedFactory.address]);
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [configurator.address, comet.address]);
    await context.fastGovernanceExecute(
      [configurator.address, proxyAdmin.address],
      [0, 0],
      ['setFactory(address,address)', 'deployAndUpgradeTo(address,address)'],
      [setFactoryCalldata, deployAndUpgradeToCalldata]
    );

    const CometModified = await dm.hre.ethers.getContractFactory('CometModified');
    const modifiedComet = CometModified.attach(comet.address).connect(signer.signer);

    // Call new functions on Comet
    await modifiedComet.initialize(constants.AddressZero);
    expect(await modifiedComet.newFunction()).to.be.equal(101n);
  }
);
