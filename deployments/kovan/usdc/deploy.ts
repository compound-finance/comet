import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { debug, deployComet, exp, sameAddress, wait } from '../../../src/deploy';
import { Bulker, Fauceteer, ProxyAdmin } from '../../../build/types';
import { Contract } from 'ethers';

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

export default async function deploy(deploymentManager: DeploymentManager, deploySpec) {
  const newRoots = await deployContracts(deploymentManager, deploySpec); // XXX fix api

  // Wait 45 seconds so we have a buffer before minting UNI
  debug("Waiting 45s before minting tokens...")
  await new Promise(r => setTimeout(r, 45_000));

  await mintToFauceteer(deploymentManager);

  return newRoots;
}

async function deployContracts(deploymentManager: DeploymentManager, deploySpec) {
  const { ethers } = deploymentManager.hre;
  const signer = await deploymentManager.getSigner();

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

  const blockNumber = await ethers.provider.getBlockNumber();
  const blockTimestamp = (await ethers.provider.getBlock(blockNumber)).timestamp;

  // Deploy UNI first because it is the flakiest (has a dependency on block timestamp)
  // XXX currently this retries with the same timestamp. we should update the timestamp on retries
  const uni = await deploymentManager.clone(
    'UNI',
    cloneAddr.uni,
    [signer.address, signer.address, blockTimestamp + 60],
    cloneNetwork
  );

  const usdcProxyAdmin = await deploymentManager.deploy(
    'USDC:proxyAdmin',
    'vendor/proxy/transparent/ProxyAdmin.sol',
    []
  );

  const fauceteer = await deploymentManager.deploy('fauceteer', 'test/Fauceteer.sol', []);

  const usdcImpl = await deploymentManager.clone('USDC:implementation', cloneAddr.usdcImpl, [], cloneNetwork);
  const usdcProxy = await deploymentManager.clone('USDC', cloneAddr.usdcProxy, [usdcImpl.address], cloneNetwork);

  debug(`Changing admin of USDC proxy to ${usdcProxyAdmin.address}`);
  await deploymentManager.retry(
    () => wait(usdcProxy.connect(signer).changeAdmin(usdcProxyAdmin.address))
  )
  const usdc = usdcImpl.attach(usdcProxy.address);
  // Give signer 10,000 USDC
  debug(`Initializing USDC`);
  await deploymentManager.retry(
    () => wait(
      usdc.connect(signer).initialize('USD Coin', 'USDC', 'USD', 6, signer.address, signer.address, signer.address, signer.address)
    )
  );

  const wbtc = await deploymentManager.clone('WBTC', cloneAddr.wbtc, [], cloneNetwork);
  const weth = await deploymentManager.clone('WETH', cloneAddr.weth, [], cloneNetwork);

  // Give admin 0.01 WETH tokens [this is a precious resource here!]
  debug(`Minting some WETH`);
  await deploymentManager.retry(
    () => wait(weth.connect(signer).deposit({ value: exp(0.01, 18) }))
  );

  const comp = await deploymentManager.clone('COMP', cloneAddr.comp, [signer.address], cloneNetwork);
  const link = await deploymentManager.clone('LINK', cloneAddr.link, [], cloneNetwork);

  // Deploy all Comet-related contracts
  await deployComet(deploymentManager, deploySpec);

  // XXX returned?
  const contracts = await deploymentManager.contracts();
  const comet = contracts.get('comet');

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'Bulker.sol',
    [timelock.address, comet.address, weth.address]
  );

  return ['comet', 'configurator', 'fauceteer', 'rewards', 'bulker'];
}

async function mintToFauceteer(deploymentManager: DeploymentManager) {
  const signer = await deploymentManager.getSigner();

  debug(`Minting as signer: ${signer.address}`);

  const contracts = await deploymentManager.contracts();
  const timelock = contracts.get('timelock');
  const fauceteer = contracts.get('fauceteer');

  // USDC
  const USDC = contracts.get('USDC');
  const usdcDecimals = await USDC.decimals();
  debug(`minting USDC@${USDC.address} to fauceteer@${fauceteer.address}`);
  await deploymentManager.retry(
    () => wait(USDC.connect(signer).configureMinter(signer.address, exp(100_000_000, usdcDecimals))) // mint 100M USDC
  );
  await deploymentManager.retry(
    () => wait(USDC.connect(signer).mint(fauceteer.address, exp(100_000_000, usdcDecimals)))
  );
  debug(`USDC.balanceOf(fauceteer.address): ${await USDC.balanceOf(fauceteer.address)}`);

  // WBTC
  const WBTC = contracts.get('WBTC');
  const wbtcDecimals = await WBTC.decimals();
  debug(`minting WBTC@${WBTC.address} to fauceteer${fauceteer.address}`);
  await deploymentManager.retry(
    () => wait(WBTC.connect(signer).mint(fauceteer.address, exp(20, wbtcDecimals))) // mint 20 WBTC
  );
  debug(`WBTC.balanceOf(fauceteer.address): ${await WBTC.balanceOf(fauceteer.address)}`);

  // COMP
  const COMP = contracts.get('COMP');
  const signerCompBalance = await COMP.balanceOf(signer.address);

  debug(`transferring ${signerCompBalance.div(2)} COMP@${COMP.address} to fauceteer@${fauceteer.address}`);
  await deploymentManager.retry(
    () => wait(COMP.connect(signer).transfer(fauceteer.address, signerCompBalance.div(2))) // transfer half of signer's balance
  );
  debug(`COMP.balanceOf(fauceteer.address): ${await COMP.balanceOf(fauceteer.address)}`);

  debug(`transferring ${signerCompBalance.div(2)} COMP@${COMP.address} to timelock@${timelock.address}`);
  await deploymentManager.retry(
    () => wait(COMP.connect(signer).transfer(timelock.address, signerCompBalance.div(2))) // transfer half of signer's balance
  );
  debug(`COMP.balanceOf(timelock.address): ${await COMP.balanceOf(timelock.address)}`);

  // UNI
  const UNI = contracts.get('UNI');
  const uniTotalSupply = await UNI.totalSupply();
  debug(`minting UNI@${UNI.address} to fauceteer@${fauceteer.address}`);
  await deploymentManager.retry(
    () => wait(UNI.connect(signer).mint(fauceteer.address, uniTotalSupply.div(1e2))) // mint 1% of total supply (UNI contract only allows minting 2% of total supply)
  );
  debug(`UNI.balanceOf(fauceteer.address): ${await UNI.balanceOf(fauceteer.address)}`);

  // LINK
  const LINK = contracts.get('LINK');
  const signerLinkBalance = await LINK.balanceOf(signer.address);
  debug(`transferring ${signerLinkBalance.div(100)} LINK@${LINK.address} to fauceteer@${fauceteer.address}`);
  await deploymentManager.retry(
    () => wait(LINK.connect(signer).transfer(fauceteer.address, signerLinkBalance.div(100))) // transfer 1% of total supply
  );
  debug(`LINK.balanceOf(fauceteer.address): ${await LINK.balanceOf(fauceteer.address)}`);
}
