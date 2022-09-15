import { scenario, setNextBaseFeeToZero, fastGovernanceExecute } from './context/CometContext';
import { expect } from 'chai';
import { constants, Contract, EventFilter, utils } from 'ethers';
import { COMP_WHALES } from "../src/deploy";
import { impersonateAddress } from '../plugins/scenario/World';
import { importContract } from '../plugins/deployment_manager/Import';

const FX_ROOT_GOERLI = '0x3d1d3E34f7fB6D26245E6640E1c50710eFFf15bA';
const STATE_SENDER = '0xeaa852323826c71cd7920c3b4c007184234c3945';

scenario.only('L2 Governance scenario', {}, async ({ comet }, context, world) => {
  const l1DeploymentManager = world.auxiliaryDeploymentManager;
  const l1Hre = l1DeploymentManager?.hre;

  if (!l1DeploymentManager || !l1Hre) {
    throw new Error("not an L2");
  }

  const l2DeploymentManager = world.deploymentManager;
  const l2Hre = l2DeploymentManager.hre;

  const l1Governor = await l1DeploymentManager.contract('governor');
  const proposer = await impersonateAddress(l1DeploymentManager, COMP_WHALES[0]);

  const l2Timelock = await world.deploymentManager.contract('timelock');
  const polygonBridgeReceiver = await world.deploymentManager.contract('polygonBridgeReceiver');

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
    [polygonBridgeReceiver?.address, encodedL2Data]
  );

  await fastGovernanceExecute(
    l1DeploymentManager,
    proposer,
    [FX_ROOT_GOERLI],
    [0],
    ["sendMessageToChild(address,bytes)"],
    [sendMessageToChildCalldata]
  );

  // listen on events on the fxRoot
  const filter: EventFilter = {
    address: STATE_SENDER,
    topics: [
      utils.id("StateSynced(uint256,address,bytes)")
    ]
  }

  const stateSyncedListenerPromise = new Promise(async (resolve, reject) => {
    l1Hre.ethers.provider.on(filter, (log) => {
      resolve(log);
    });

    setTimeout(() => {
      reject(new Error('timeout'));
    }, 60000);
  });

  // XXX type for stateSyncedEvent
  const stateSyncedEvent: any = await stateSyncedListenerPromise;

  const stateSenderInterface = new l1Hre.ethers.utils.Interface([
    "event StateSynced(uint256 indexed id, address indexed contractAddress, bytes data)"
  ]);

  const { contractAddress, data: stateSyncedData } = stateSenderInterface.decodeEventLog(
    "StateSynced",
    stateSyncedEvent.data,
    stateSyncedEvent.topics
  );

  const fxChildBuildFile = await importContract(
    'mumbai',
    contractAddress
  );
  const fxChildContract = new l1DeploymentManager.hre.ethers.Contract(
    fxChildBuildFile.contracts["contracts/FxChild.sol:FxChild"].address as string,
    fxChildBuildFile.contracts["contracts/FxChild.sol:FxChild"].abi as string
  );

  const MUMBAI_RECEIVER_ADDRESSS = '0x0000000000000000000000000000000000001001';
  const mumbaiReceiverSigner = await context.world.impersonateAddress(MUMBAI_RECEIVER_ADDRESSS);

  await setNextBaseFeeToZero(l2DeploymentManager);
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
  const timelockInterface = new l2Hre.ethers.utils.Interface([
    "event QueueTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature, bytes data, uint eta)",
    "event ExecuteTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature, bytes data, uint eta)"
  ]);

  const decodedEvent = timelockInterface.decodeEventLog(
    "QueueTransaction",
    queueTransactionEvent.data,
    queueTransactionEvent.topics
  );
  const { target, value, signature, data, eta} = decodedEvent;

  // fast forward l2 time
  await context.setNextBlockTimestamp(eta.toNumber() + 1);

  // check delay before
  console.log(`await l2Timelock?.delay(): ${await l2Timelock?.delay()}`);
  expect(await l2Timelock?.delay()).to.eq(2 * 24 * 60 * 60);

  await setNextBaseFeeToZero(l2DeploymentManager);
  // execute queue transaction
  await polygonBridgeReceiver?.executeTransaction(
    target,
    value,
    signature,
    data,
    eta,
    { gasPrice: 0 }
  );

  // check delay before
  console.log(`await l2Timelock?.delay(): ${await l2Timelock?.delay()}`);
  expect(await l2Timelock?.delay()).to.eq(fiveDaysInSeconds);
});

scenario('upgrade Comet implementation and initialize', {}, async ({ comet, configurator, proxyAdmin }, context, world) => {
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
});

scenario('upgrade Comet implementation and initialize using deployUpgradeToAndCall', {}, async ({ comet, configurator, proxyAdmin }, context, world) => {
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
});

scenario('upgrade Comet implementation and call new function', {}, async ({ comet, configurator, proxyAdmin, actors }, context, world) => {
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
});
