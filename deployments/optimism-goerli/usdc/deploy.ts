import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp, wait } from '../../../src/deploy';

const clone = {
  op: '0x4200000000000000000000000000000000000042'
};

const secondsPerDay = 24 * 60 * 60;

const GOERLI_TIMELOCK = '0x8Fa336EB4bF58Cfc508dEA1B0aeC7336f55B1399';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const deployed = await deployContracts(deploymentManager, deploySpec);
  await mintTokens(deploymentManager);
  return deployed;
}

async function deployContracts(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed> {
  const trace = deploymentManager.tracer();
  const ethers = deploymentManager.hre.ethers;

  // Pull in existing assets
  const WETH = await deploymentManager.existing(
    'WETH',
    '0x4200000000000000000000000000000000000006',
    'optimism-goerli'
  );

  // Clone OP so we can mint it
  const OP = await deploymentManager.clone('OP', clone.op, [], 'optimism');

  const l2CrossDomainMessenger = await deploymentManager.existing(
    'l2CrossDomainMessenger',
    ['0xC0d3c0d3c0D3c0D3C0d3C0D3C0D3c0d3c0d30007', '0x4200000000000000000000000000000000000007'],
    'optimism-goerli'
  );

  const l2StandardBridge = await deploymentManager.existing(
    'l2StandardBridge',
    ['0xC0d3c0d3c0D3c0d3C0D3c0D3C0d3C0D3C0D30010', '0x4200000000000000000000000000000000000010'],
    'optimism-goerli'
  );

  // Deploy OptimismBridgeReceiver
  const bridgeReceiver = await deploymentManager.deploy(
    'bridgeReceiver',
    'bridges/optimism/OptimismBridgeReceiver.sol',
    [l2CrossDomainMessenger.address]
  );

  // Deploy Local Timelock
  const localTimelock = await deploymentManager.deploy(
    'timelock',
    'vendor/Timelock.sol',
    [
      bridgeReceiver.address, // admin
      10 * 60,                // delay
      14 * secondsPerDay,     // grace period
      10 * 60,                // minimum delay
      30 * secondsPerDay      // maximum delay
    ]
  );

  // Initialize PolygonBridgeReceiver
  await deploymentManager.idempotent(
    async () => !(await bridgeReceiver.initialized()),
    async () => {
      trace(`Initializing BridgeReceiver`);
      await bridgeReceiver.initialize(
        GOERLI_TIMELOCK,      // govTimelock
        localTimelock.address // localTimelock
      );
      trace(`BridgeReceiver initialized`);
    }
  );

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec);
  const { comet } = deployed;

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'bulkers/BaseBulker.sol',
    [
      await comet.governor(), // admin
      WETH.address            // weth
    ]
  );

  // Deploy fauceteer
  const fauceteer = await deploymentManager.deploy('fauceteer', 'test/Fauceteer.sol', []);

  return {
    bridgeReceiver,
    l2CrossDomainMessenger,
    l2StandardBridge,
    bulker,
    fauceteer,
    ...deployed
  };
}

async function mintTokens(deploymentManager: DeploymentManager) {
  const trace = deploymentManager.tracer();
  const signer = await deploymentManager.getSigner();
  const fauceteer = await deploymentManager.getContractOrThrow('fauceteer');

  trace(`Attempting to mint as ${signer.address}...`);

  const OP = await deploymentManager.getContractOrThrow('OP');
  await deploymentManager.idempotent(
    async () => (await OP.balanceOf(fauceteer.address)).eq(0),
    async () => {
      trace(`Minting 50M OP to fauceteer`);
      const amount = exp(50_000_000, await OP.decimals());
      trace(await wait(OP.connect(signer).mint(fauceteer.address, amount)));
      trace(`OP.balanceOf(${fauceteer.address}): ${await OP.balanceOf(fauceteer.address)}`);
    }
  );
}