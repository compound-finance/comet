import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { ERC20, ProxyAdmin, ProxyAdmin__factory } from '../../../build/types';
import { exp, wait } from '../../../test/helpers';
import { Contract } from 'ethers';

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

export async function deployUSDC(
  deploymentManager: DeploymentManager,
  signerAddress: string
): Promise<ERC20> {
  let usdcProxyAdminArgs: [] = [];
  let usdcProxyAdmin = await deploymentManager.deploy<ProxyAdmin, ProxyAdmin__factory, []>(
    'vendor/proxy/ProxyAdmin.sol',
    usdcProxyAdminArgs
  );

  let usdcImplementation = await deploymentManager.clone(
    cloneAddr.usdcImplementation,
    [],
    cloneNetwork
  );

  let usdcProxy = await deploymentManager.clone(
    cloneAddr.usdcProxy,
    [usdcImplementation.address],
    cloneNetwork
  );

  await wait(await usdcProxy.changeAdmin(usdcProxyAdmin.address));
  let usdc = usdcImplementation.attach(usdcProxy.address);

  // Give signer 10,000 USDC
  await wait(
    usdc.initialize(
      'USD Coin',
      'USDC',
      'USD',
      6,
      signerAddress,
      signerAddress,
      signerAddress,
      signerAddress
    )
  );
  await wait(usdc.configureMinter(signerAddress, exp(10000, 6)));
  await wait(usdc.mint(signerAddress, exp(10000, 6)));

  return usdc as ERC20;
}

export async function deployWBTC(
  deploymentManager: DeploymentManager,
  signerAddress: string
): Promise<ERC20> {
  let wbtc = await deploymentManager.clone(cloneAddr.wbtc, [], cloneNetwork);
  // Give signer 1000 WBTC
  await wait(wbtc.mint(signerAddress, exp(1000, 8)));

  return wbtc as ERC20;
}

export async function deployWETH(
  deploymentManager: DeploymentManager,
  signerAddress: string
): Promise<ERC20> {
  let weth = await deploymentManager.clone(cloneAddr.weth, [], cloneNetwork);
  // Give admin 0.01 WETH tokens [this is a precious resource here!]
  await wait(weth.deposit({ value: exp(0.01, 18) }));

  return weth as ERC20;
}

export async function deployCOMP(
  deploymentManager: DeploymentManager,
  signerAddress: string
): Promise<ERC20> {
  return await deploymentManager.clone(cloneAddr.comp, [signerAddress], cloneNetwork);
}

export async function deployUNI(
  deploymentManager: DeploymentManager,
  signerAddress: string
): Promise<ERC20> {
  return await deploymentManager.clone(
    cloneAddr.uni,
    [signerAddress, signerAddress, 99999999999],
    cloneNetwork
  );
}

export async function deployLINK(
  deploymentManager: DeploymentManager,
  signerAddress: string
): Promise<ERC20> {
  return await deploymentManager.clone(cloneAddr.link, [], cloneNetwork);
}

export async function deployToken(
  name: string,
  deploymentManager: DeploymentManager,
  signerAddress: string
): Promise<ERC20> {
  switch (name.toLowerCase()) {
    case 'usdc':
      return await deployUSDC(deploymentManager, signerAddress);
    case 'wbtc':
      return await deployWBTC(deploymentManager, signerAddress);
    case 'weth':
      return await deployWETH(deploymentManager, signerAddress);
    case 'comp':
      return await deployCOMP(deploymentManager, signerAddress);
    case 'uni':
      return await deployUNI(deploymentManager, signerAddress);
    case 'link':
      return await deployLINK(deploymentManager, signerAddress);
    default:
      throw new Error(`Do not know how to clone mainnet token: ${name}`);
  }
}
