import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { Bulker, Fauceteer, ProxyAdmin } from '../../../build/types';
import { DeploySpec, debug, deployComet, exp, getBlock, sameAddress, wait } from '../../../src/deploy';

const cloneNetwork = 'mainnet';
const cloneAddr = {
  usdcImpl: '0xa2327a938Febf5FEC13baCFb16Ae10EcBc4cbDCF',
  usdcProxy: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  wbtc: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
  weth: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  comp: '0xc00e94cb662c3520282e6f5717214004a7f26888',
  uni: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
  link: '0x514910771af9ca656af840dff83e8264ecf986ca',
};

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const deployed = await deployContracts(deploymentManager, deploySpec);
  await mintTokens(deploymentManager);
  return deployed;
}

async function deployContracts(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const { ethers } = deploymentManager.hre;
  const signer = await deploymentManager.getSigner();

  // Deploy fauceteer (XXX probably first in order to mint cloned gov COMP to it)
  const fauceteer = await deploymentManager.deploy('fauceteer', 'test/Fauceteer.sol', []);

  // XXX clone
  const governor = await deploymentManager.deploy('governor', 'test/GovernorSimple.sol', []);
  const timelock = await deploymentManager.deploy('timelock', 'test/SimpleTimelock.sol', [governor.address]);

  // XXX will fail if gov already has a diff timelock, and technically should otherwise ensure admin
  //  but we are anyway replacing gov simple
  await deploymentManager.idempotent(
    async () => !sameAddress(await governor.timelock(), timelock.address),
    async () => {
      debug(`Initializing GovSimple`);
      await wait(governor.initialize(timelock.address, [signer.address]));
    }
  );

  // Deploy UNI first because it is the flakiest (has a dependency on block timestamp)
  // TODO: currently this retries with the same timestamp. we should update the timestamp on retries
  const UNI = await deploymentManager.clone(
    'UNI',
    cloneAddr.uni,
    [signer.address, signer.address, (await getBlock(null, ethers)).timestamp + 60],
    cloneNetwork
  );

  const usdcProxyAdmin = await deploymentManager.deploy(
    'USDC:proxyAdmin',
    'vendor/proxy/transparent/ProxyAdmin.sol',
    []
  );

  const usdcImpl = await deploymentManager.clone('USDC:implementation', cloneAddr.usdcImpl, [], cloneNetwork);
  const usdcProxy = await deploymentManager.clone('USDC', cloneAddr.usdcProxy, [usdcImpl.address], cloneNetwork);
  const usdcProxyAdminSlot = '0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b';
  const USDC = usdcImpl.attach(usdcProxy.address);

  await deploymentManager.idempotent(
    async () => !sameAddress(await ethers.provider.getStorageAt(usdcProxy.address, usdcProxyAdminSlot), usdcProxyAdmin.address),
    async () => {
      debug(`Changing admin of USDC proxy to ${usdcProxyAdmin.address}`);
      await wait(usdcProxy.connect(signer).changeAdmin(usdcProxyAdmin.address));

      debug(`Initializing USDC`);
      await wait(USDC.connect(signer).initialize(
        'USD Coin',     // name
        'USDC',         // symbol
        'USD',          // currency
        6,              // decimals
        signer.address, // Master Minter
        signer.address, // Pauser
        signer.address, // Blacklister
        signer.address  // Owner
      ));
    }
  );

  const WBTC = await deploymentManager.clone('WBTC', cloneAddr.wbtc, [], cloneNetwork);
  const WETH = await deploymentManager.clone('WETH', cloneAddr.weth, [], cloneNetwork);
  const COMP = await deploymentManager.clone('COMP', cloneAddr.comp, [signer.address], cloneNetwork);
  const LINK = await deploymentManager.clone('LINK', cloneAddr.link, [], cloneNetwork);

  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec);
  const { comet } = deployed;

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'Bulker.sol',
    [timelock.address, comet.address, WETH.address]
  );

  return { ...deployed, fauceteer, bulker };
}

async function mintTokens(deploymentManager: DeploymentManager) {
  const signer = await deploymentManager.getSigner();
  const contracts = await deploymentManager.contracts();
  const timelock = contracts.get('timelock');
  const fauceteer = contracts.get('fauceteer');

  debug(`Attempting to mint as ${signer.address}...`);

  const WETH = contracts.get('WETH');
  await deploymentManager.idempotent(
    async () => (await WETH.balanceOf(signer.address)).lt(exp(0.01, 18)),
    async () => {
      debug(`Minting 0.01 WETH for signer (this is a precious resource!)`);
      await wait(WETH.connect(signer).deposit({ value: exp(0.01, 18) }));
      debug(`WETH.balanceOf(${signer.address}): ${await WETH.balanceOf(signer.address)}`);
    }
  );

  // If we haven't spidered new contracts (which we could before minting, but its slow),
  //  then the proxy contract won't have the impl functions yet, so just do it explicitly
  const usdcProxy = contracts.get('USDC'), usdcImpl = contracts.get('USDC:implementation');
  const USDC = usdcImpl.attach(usdcProxy.address);
  await deploymentManager.idempotent(
    async () => sameAddress(await USDC.owner(), signer.address),
    async () => {
      debug(`Minting 100M USDC to fauceteer`);
      const amount = exp(100_000_000, await USDC.decimals());
      await wait(USDC.connect(signer).configureMinter(signer.address, amount));
      await wait(USDC.connect(signer).mint(fauceteer.address, amount));
      debug(`USDC.balanceOf(${fauceteer.address}): ${await USDC.balanceOf(fauceteer.address)}`);
    }
  );

  const WBTC = contracts.get('WBTC');
  await deploymentManager.idempotent(
    async () => sameAddress(await WBTC.owner(), signer.address),
    async () => {
      debug(`Minting 20 WBTC to fauceteer`);
      const amount = exp(20, await WBTC.decimals());
      await wait(WBTC.connect(signer).mint(fauceteer.address, amount));
      debug(`WBTC.balanceOf(${fauceteer.address}): ${await WBTC.balanceOf(fauceteer.address)}`);
    }
  );

  const COMP = contracts.get('COMP');
  await deploymentManager.idempotent(
    async () => (await COMP.balanceOf(signer.address)).eq(await COMP.totalSupply()),
    async () => {
      debug(`Sending half of all COMP to fauceteer, half to timelock`);
      const amount = (await COMP.balanceOf(signer.address)).div(2);
      await wait(COMP.connect(signer).transfer(fauceteer.address, amount));
      await wait(COMP.connect(signer).transfer(timelock.address, amount));
      debug(`COMP.balanceOf(${fauceteer.address}): ${await COMP.balanceOf(fauceteer.address)}`);
      debug(`COMP.balanceOf(${timelock.address}): ${await COMP.balanceOf(timelock.address)}`);
    }
  );

  const LINK = contracts.get('LINK');
  await deploymentManager.idempotent(
    async () => (await LINK.balanceOf(signer.address)).eq(await LINK.totalSupply()),
    async () => {
      debug(`Sending half of all LINK to fauceteer`);
      const amount = (await LINK.balanceOf(signer.address)).div(2);
      await wait(LINK.connect(signer).transfer(fauceteer.address, amount));
      debug(`LINK.balanceOf(${fauceteer.address}): ${await LINK.balanceOf(fauceteer.address)}`);
    }
  );

  const UNI = contracts.get('UNI');
  await deploymentManager.idempotent(
    async () => sameAddress(await UNI.minter(), signer.address),
    async () => {
      debug(`Minting 1% of UNI to fauceteer (mintCap is 2%, first waiting 45s...)`);
      const amount = (await UNI.totalSupply()).div(1e2);
      await new Promise(r => setTimeout(r, 45_000));
      await wait(UNI.connect(signer).mint(fauceteer.address, amount));
      debug(`UNI.balanceOf(${fauceteer.address}): ${await UNI.balanceOf(fauceteer.address)}`);
    }
  );
}
