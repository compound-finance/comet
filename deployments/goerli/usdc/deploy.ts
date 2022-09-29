import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, cloneGov, deployComet, exp, sameAddress, wait } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const deployed = await deployContracts(deploymentManager, deploySpec);
  await mintTokens(deploymentManager);
  return deployed;
}

async function deployContracts(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const trace = deploymentManager.tracer()
  const ethers = deploymentManager.hre.ethers;
  const signer = await deploymentManager.getSigner();

  // Declare existing assets as aliases
  const COMP = await deploymentManager.existing('COMP', '0x3587b2F7E0E2D6166d6C14230e7Fe160252B0ba4');
  const USDC = await deploymentManager.existing('USDC', '0x07865c6E87B9F70255377e024ace6630C1Eaa37F');
  const WBTC = await deploymentManager.existing('WBTC', '0xAAD4992D949f9214458594dF92B44165Fb84dC19');
  const WETH = await deploymentManager.existing('WETH', '0x42a71137C09AE83D8d05974960fd607d40033499');

  // Goerli -> Mumbai bridge contract
  const fxRoot = await deploymentManager.existing('fxRoot', '0x3d1d3e34f7fb6d26245e6640e1c50710efff15ba', 'goerli');

  // Deploy governance contracts
  const { fauceteer, timelock } = await cloneGov(deploymentManager);

  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec);
  const { rewards } = deployed;

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'Bulker.sol',
    [timelock.address, WETH.address]
  );

  await deploymentManager.idempotent(
    async () => (await COMP.balanceOf(rewards.address)).eq(0),
    async () => {
      trace(`Sending some COMP to CometRewards`);
      const amount = exp(1_000_000, 18);
      trace(await wait(COMP.connect(signer).transfer(rewards.address, amount)));
      trace(`COMP.balanceOf(${rewards.address}): ${await COMP.balanceOf(rewards.address)}`);
      trace(`COMP.balanceOf(${signer.address}): ${await COMP.balanceOf(signer.address)}`);
    }
  );

  return { ...deployed, fauceteer, bulker, fxRoot };
}

async function mintTokens(deploymentManager: DeploymentManager) {
  const trace = deploymentManager.tracer();
  const signer = await deploymentManager.getSigner();
  const contracts = await deploymentManager.contracts();
  const fauceteer = contracts.get('fauceteer');

  trace(`Attempting to mint as ${signer.address}...`);

  const WETH = contracts.get('WETH');
  await deploymentManager.idempotent(
    async () => (await WETH.balanceOf(signer.address)).lt(exp(0.01, 18)),
    async () => {
      trace(`Minting 0.01 WETH for signer (this is a precious resource!)`);
      trace(await wait(WETH.connect(signer).deposit({ value: exp(0.01, 18) })));
      trace(`WETH.balanceOf(${signer.address}): ${await WETH.balanceOf(signer.address)}`);
    }
  );

  const WBTC = contracts.get('WBTC');
  await deploymentManager.idempotent(
    async () => (await WBTC.balanceOf(fauceteer.address)).eq(0),
    async () => {
      trace(`Minting 20 WBTC to fauceteer`);
      const amount = exp(20, await WBTC.decimals());
      trace(await wait(WBTC.connect(signer).mint(fauceteer.address, amount)));
      trace(`WBTC.balanceOf(${fauceteer.address}): ${await WBTC.balanceOf(fauceteer.address)}`);
    }
  );
}