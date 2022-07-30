import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../plugins/deployment_manager/Migration';
import { deployComet } from '../../src/deploy';
import { exp, wait } from '../../test/helpers';
import {
  Bulker,
  Bulker__factory,
  Fauceteer,
  Fauceteer__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
} from '../../build/types';
import { Contract } from 'ethers';
import { debug } from '../../plugins/deployment_manager/Utils';

let cloneNetwork = 'mainnet';
let cloneAddr = {
  usdcImplementation: '0xa2327a938Febf5FEC13baCFb16Ae10EcBc4cbDCF',
  usdcProxy: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  wbtc: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
  weth: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  comp: '0xc00e94cb662c3520282e6f5717214004a7f26888',
  uni: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
  link: '0x514910771af9ca656af840dff83e8264ecf986ca',
};

interface Vars {
  comet: string,
  configurator: string,
  fauceteer: string,
  rewards: string,
  bulker: string
};

export default async function deploy(deploymentManager: DeploymentManager) {
  const newRoots = await deployContracts(deploymentManager);
  deploymentManager.putRoots(new Map(Object.entries(newRoots)));

  debug("Roots.json have been set to:");
  debug("");
  debug("");
  debug(JSON.stringify(newRoots, null, 4));
  debug("");

  // We have to re-spider to get the new deployments
  await deploymentManager.spider();

  // Wait 45 seconds so we have a buffer before minting UNI
  debug("Waiting 45s before minting tokens...")
  await new Promise(r => setTimeout(r, 45_000));

  await mintToFauceteer(deploymentManager);

  return newRoots;
}

async function deployContracts(deploymentManager: DeploymentManager): Promise<Vars> {
  const { ethers } = deploymentManager.hre;
  let signer = await deploymentManager.getSigner();
  let signerAddress = signer.address;

  const blockNumber = await ethers.provider.getBlockNumber();
  const blockTimestamp = (await ethers.provider.getBlock(blockNumber)).timestamp;

  // Deploy UNI first because it is the flakiest (has a dependency on block timestamp)
  // XXX currently this retries with the same timestamp. we should update the timestamp on retries
  let uni = await deploymentManager.clone(
    cloneAddr.uni,
    [signerAddress, signerAddress, blockTimestamp + 60],
    cloneNetwork
  );

  let usdcProxyAdminArgs: [] = [];
  let usdcProxyAdmin = await deploymentManager.deploy<ProxyAdmin, ProxyAdmin__factory, []>(
    'vendor/proxy/transparent/ProxyAdmin.sol',
    usdcProxyAdminArgs
  );

  let fauceteer = await deploymentManager.deploy<Fauceteer, Fauceteer__factory, []>(
    'test/Fauceteer.sol',
    []
  );

  let usdcImplementation = await deploymentManager.clone(
    cloneAddr.usdcImplementation,
    [],
    cloneNetwork
  );

  let usdc;
  let usdcProxy = await deploymentManager.clone(
    cloneAddr.usdcProxy,
    [usdcImplementation.address],
    cloneNetwork
  );

  debug(`Changing admin of USDC proxy to ${usdcProxyAdmin.address}`);
  await deploymentManager.asyncCallWithRetry(
    (signer_) => wait(usdcProxy.connect(signer_).changeAdmin(usdcProxyAdmin.address))
  )
  usdc = usdcImplementation.attach(usdcProxy.address);
  // Give signer 10,000 USDC
  debug(`Initializing USDC`);
  await deploymentManager.asyncCallWithRetry(
    (signer_) => wait(
      usdc.connect(signer_).initialize(
        'USD Coin',
        'USDC',
        'USD',
        6,
        signerAddress,
        signerAddress,
        signerAddress,
        signerAddress
      )
    )
  );

  let wbtc = await deploymentManager.clone(
    cloneAddr.wbtc,
    [],
    cloneNetwork
  );

  let weth = await deploymentManager.clone(
    cloneAddr.weth,
    [],
    cloneNetwork
  );
  // Give admin 0.01 WETH tokens [this is a precious resource here!]
  debug(`Minting some WETH`);
  await deploymentManager.asyncCallWithRetry(
    (signer_) => wait(weth.connect(signer_).deposit({ value: exp(0.01, 18) }))
  );

  let comp = await deploymentManager.clone(
    cloneAddr.comp,
    [signerAddress],
    cloneNetwork
  );

  let link = await deploymentManager.clone(
    cloneAddr.link,
    [],
    cloneNetwork
  );

  // Contracts referenced in `configuration.json`.
  let contracts = new Map<string, Contract>([
    ['USDC', usdc],
    ['WBTC', wbtc],
    ['WETH', weth],
    ['COMP', comp],
    ['UNI', uni],
    ['LINK', link],
  ]);

  // Deploy all Comet-related contracts
  let { cometProxy, configuratorProxy, timelock, rewards } = await deployComet(
    deploymentManager,
    { all: true },
    {},
    contracts
  );

  // Deploy Bulker
  const bulker = await deploymentManager.deploy<Bulker, Bulker__factory, [string, string, string]>(
    'Bulker.sol',
    [timelock.address, cometProxy.address, weth.address]
  );

  return {
    comet: cometProxy.address,
    configurator: configuratorProxy.address,
    fauceteer: fauceteer.address,
    rewards: rewards.address,
    bulker: bulker.address
  };
}

async function mintToFauceteer(deploymentManager: DeploymentManager) {
  const signer = await deploymentManager.getSigner();
  const signerAddress = signer.address;

  debug(`Minting as signer: ${signerAddress}`);

  const contracts = await deploymentManager.contracts();
  const timelock = contracts.get('timelock');
  const fauceteer = contracts.get('fauceteer');
  const fauceteerAddress = fauceteer.address;

  // USDC
  const USDC = contracts.get('USDC');
  const usdcDecimals = await USDC.decimals();
  debug(`minting USDC@${USDC.address} to fauceteer@${fauceteerAddress}`);
  await deploymentManager.asyncCallWithRetry(
    (signer_) => wait(USDC.connect(signer_).configureMinter(signerAddress, exp(100_000_000, usdcDecimals))) // mint 100M USDC
  );
  await deploymentManager.asyncCallWithRetry(
    (signer_) => wait(USDC.connect(signer_).mint(fauceteerAddress, exp(100_000_000, usdcDecimals)))
  );
  debug(`USDC.balanceOf(fauceteerAddress): ${await USDC.balanceOf(fauceteerAddress)}`);

  // WBTC
  const WBTC = contracts.get('WBTC');
  const wbtcDecimals = await WBTC.decimals();
  debug(`minting WBTC@${WBTC.address} to fauceteer${fauceteerAddress}`);
  await deploymentManager.asyncCallWithRetry(
    (signer_) => wait(WBTC.connect(signer_).mint(fauceteerAddress, exp(20, wbtcDecimals))) // mint 20 WBTC
  );
  debug(`WBTC.balanceOf(fauceteerAddress): ${await WBTC.balanceOf(fauceteerAddress)}`);

  // COMP
  const COMP = contracts.get('COMP');
  const signerCompBalance = await COMP.balanceOf(signerAddress);

  debug(`transferring ${signerCompBalance.div(2)} COMP@${COMP.address} to fauceteer@${fauceteerAddress}`);
  await deploymentManager.asyncCallWithRetry(
    (signer_) => wait(COMP.connect(signer_).transfer(fauceteerAddress, signerCompBalance.div(2))) // transfer half of signer's balance
  );
  debug(`COMP.balanceOf(fauceteerAddress): ${await COMP.balanceOf(fauceteerAddress)}`);

  debug(`transferring ${signerCompBalance.div(2)} COMP@${COMP.address} to timelock@${timelock.address}`);
  await deploymentManager.asyncCallWithRetry(
    (signer_) => wait(COMP.connect(signer_).transfer(timelock.address, signerCompBalance.div(2))) // transfer half of signer's balance
  );
  debug(`COMP.balanceOf(timelock.address): ${await COMP.balanceOf(timelock.address)}`);

  // UNI
  const UNI = contracts.get('UNI');
  const uniTotalSupply = await UNI.totalSupply();
  debug(`minting UNI@${UNI.address} to fauceteer@${fauceteerAddress}`);
  await deploymentManager.asyncCallWithRetry(
    (signer_) => wait(UNI.connect(signer_).mint(fauceteerAddress, uniTotalSupply.div(1e2))) // mint 1% of total supply (UNI contract only allows minting 2% of total supply)
  );
  debug(`UNI.balanceOf(fauceteerAddress): ${await UNI.balanceOf(fauceteerAddress)}`);

  // LINK
  const LINK = contracts.get('LINK');
  const signerLinkBalance = await LINK.balanceOf(signerAddress);
  debug(`transferring ${signerLinkBalance.div(100)} LINK@${LINK.address} to fauceteer@${fauceteerAddress}`);
  await deploymentManager.asyncCallWithRetry(
    (signer_) => wait(LINK.connect(signer_).transfer(fauceteerAddress, signerLinkBalance.div(100))) // transfer 1% of total supply
  );
  debug(`LINK.balanceOf(fauceteerAddress): ${await LINK.balanceOf(fauceteerAddress)}`);
}
