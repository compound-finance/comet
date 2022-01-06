import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeploymentManager, Roots } from '../plugins/deployment_manager/DeploymentManager';
import {
  Comet__factory,
  Comet,
  FaucetToken__factory,
  FaucetToken,
  MockedOracle,
  MockedOracle__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
  TransparentUpgradeableProxy__factory,
  TransparentUpgradeableProxy,
} from '../build/types';
import { ConfigurationStruct } from '../build/types/Comet';
export { Comet } from '../build/types';

async function verifyContract(
  hre: HardhatRuntimeEnvironment,
  address: string,
  constructorArguments,
  retries = 10
) {
  try {
    return await hre.run('verify:verify', {
      address,
      constructorArguments,
    });
  } catch (e) {
    if (e.message.match(/Already Verified/i)) {
      console.log('Contract at address ' + address + ' is already verified on Etherscan');
      return;
    } else if (e.message.match(/does not have bytecode/i) && retries > 0) {
      console.log('Waiting for ' + address + ' to propagate to Etherscan');
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return verifyContract(hre, address, constructorArguments, retries - 1);
    } else {
      console.error(`Unable to verify contract at ${address}: ${e}`);
      console.error(`Continuing on anyway...`);
    }
  }
}

async function makeToken(deploymentManager: DeploymentManager, verify: boolean, initialAmount: number, tokenName: string, decimalUnits: number, tokenSymbol: string): Promise<FaucetToken> {
  const tokenArgs: [number, string, number, string] = [initialAmount, tokenName, decimalUnits, tokenSymbol];
  console.log('Deploying token...');
  const token = await deploymentManager.deploy<
    FaucetToken,
    FaucetToken__factory,
    [number, string, number, string]
  >('asteroid/FaucetToken.sol', tokenArgs);
  if (verify) {
    await verifyContract(deploymentManager.hre, token.address, tokenArgs);
  }
  console.log('FaucetToken deployed to:', token.address);

  return token;
}

export async function deployComet(
  deploymentManager: DeploymentManager,
  verify: boolean = false
): Promise<{ comet: Comet; oracle: MockedOracle; proxy: TransparentUpgradeableProxy }> {
  let hre = deploymentManager.hre;

  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  await hre.run('compile');

  const [governor, pauseGuardian] = await hre.ethers.getSigners();

  let baseToken = await makeToken(deploymentManager, verify, 100000, 'DAI', 18, 'DAI');

  let asset0 = await makeToken(deploymentManager, verify, 200000, 'GOLD', 8, 'GOLD');
  let assetInfo0 = { asset: asset0.address, borrowCollateralFactor: 1e18.toString(), liquidateCollateralFactor: 1e18.toString() };
  let asset1 = await makeToken(deploymentManager, verify, 300000, 'SILVER', 10, 'SILVER');
  let assetInfo1 = { asset: asset1.address, borrowCollateralFactor: 0.5e18.toString(), liquidateCollateralFactor: 0.5e18.toString() };

  console.log('Deploying oracle...');
  const oracle = await deploymentManager.deploy<MockedOracle, MockedOracle__factory, []>(
    'asteroid/MockedOracle.sol',
    [],
    governor
  );
  if (verify) {
    await verifyContract(hre, oracle.address, []);
  }
  console.log('Oracle deployed to:', oracle.address);

  console.log('Deploying comet...');
  const cometArg = {
    governor: await governor.getAddress(),
    pauseGuardian: await pauseGuardian.getAddress(),
    priceOracle: oracle.address,
    baseToken: baseToken.address,
    assetInfo: [assetInfo0, assetInfo1]
  };
  const comet = await deploymentManager.deploy<Comet, Comet__factory, [ConfigurationStruct]>(
    'Comet.sol',
    [cometArg]
  );
  if (verify) {
    await verifyContract(hre, comet.address, [cometArg]);
  }
  console.log('Comet deployed to:', comet.address);

  console.log('Deploying proxy admin...');
  let proxyAdminArgs: [] = [];
  const proxyAdmin = await deploymentManager.deploy<
    ProxyAdmin,
    ProxyAdmin__factory,
    []
  >('asteroid/vendor/proxy/ProxyAdmin.sol', proxyAdminArgs);
  if (verify) {
    await verifyContract(hre, proxyAdmin.address, proxyAdminArgs);
  }
  console.log('Proxy admin deployed to:', proxyAdmin.address);

  console.log('Deploying proxy...');
  let proxyArgs: [string, string, []] = [comet.address, proxyAdmin.address, []];
  const proxy = await deploymentManager.deploy<
    TransparentUpgradeableProxy,
    TransparentUpgradeableProxy__factory,
    [string, string, []]
  >('asteroid/vendor/proxy/TransparentUpgradeableProxy.sol', proxyArgs);
  if (verify) {
    await verifyContract(hre, proxy.address, proxyArgs);
  }
  console.log('Proxy deployed to:', proxy.address);

  await deploymentManager.setRoots({ TransparentUpgradeableProxy: proxy.address } as Roots);

  return {
    comet,
    oracle,
    proxy,
  };
}
