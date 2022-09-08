import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, cloneGov, deployComet, exp, sameAddress, wait } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const deployed = await deployContracts(deploymentManager, deploySpec);
  // XXX mint tokens
  return deployed;
}

async function deployContracts(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const trace = deploymentManager.tracer()
  const ethers = deploymentManager.hre.ethers;
  const signer = await deploymentManager.getSigner();

  // Deploy BridgeTimelock
  trace(`Deploying BridgeTimelock`);
  const bridgeTimelock = await deploymentManager.deploy(
    'bridgeTimelock',
    'bridges/BridgeTimelock.sol',
    [
      signer.address, // admin
      signer.address, // guardian
      2 * 24 * 60 * 60 // delay (min of 2 days)
    ]
  );
  trace(`BridgeTimelock deployed @${bridgeTimelock.address}`);

  // XXX deploy l2 contracts

  // deploy PolygonBridgeReceiver(mainnetTimelock, l2Timelock)
  //   mainnetTime = goerli timelock address
  //   l2Time = bridgeTimelock.address

  // bridgeTimelock.connect(signer).queueTransaction(
  //   // bridgeTimelock.setPendingAdmin(polygonBridgeReceiver.address)
  // )

  // bridgeTimelock.executeTransaction() // execute the above transaction

  // polygonBridgeReceiver.initialize() // accept admin

  return {
    bridgeTimelock
  };
}