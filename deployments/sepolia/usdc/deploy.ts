import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, cloneGov, deployComet, exp, sameAddress, wait } from '../../../src/deploy';

const clone = {
  wbtc: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
  weth: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
};

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const deployed = await deployContracts(deploymentManager, deploySpec);
  await mintTokens(deploymentManager);
  return deployed;
}

async function deployContracts(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const trace = deploymentManager.tracer()
  const signer = await deploymentManager.getSigner();

  // Deploy governance contracts
  const { COMP, fauceteer, timelock } = await cloneGov(deploymentManager);

  // Clone collateral assets from mainnet
  const WBTC = await deploymentManager.clone('WBTC', clone.wbtc, []);
  const WETH = await deploymentManager.clone('WETH', clone.weth, []);

  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec);
  const { rewards } = deployed;

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'bulkers/BaseBulker.sol',
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

  return { ...deployed, fauceteer, bulker };
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