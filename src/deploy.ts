import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeploymentManager, Roots } from '../plugins/deployment_manager/DeploymentManager';
import {
  Comet__factory,
  Comet,
  FaucetToken__factory,
  FaucetToken,
  MockedOracle,
  MockedOracle__factory,
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
    }
    throw e;
  }
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

  const [governor, user1] = await hre.ethers.getSigners();

  const tokenArgs: [number, string, number, string] = [100000, 'DAI', 18, 'DAI'];
  console.log('Deploying token...');
  const token = await deploymentManager.deploy<
    FaucetToken,
    FaucetToken__factory,
    [number, string, number, string]
  >('asteroid/FaucetToken.sol', tokenArgs);
  if (verify) {
    await verifyContract(hre, token.address, tokenArgs);
  }
  console.log('FaucetToken deployed to:', token.address);

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
  const assets = ['0x73967c6a0904aa032c103b4104747e88c566b1a2', '0xe4e81fa6b16327d4b78cfeb83aade04ba7075165'];
  const cometArg = {
    governor: await governor.getAddress(),
    priceOracle: oracle.address,
    baseToken: token.address,
    assetInfo: [{ asset: assets[0], borrowCollateralFactor: 1e18.toString(), liquidateCollateralFactor: 1e18.toString() }, { asset: assets[1], borrowCollateralFactor: 1e18.toString(), liquidateCollateralFactor: 1e18.toString() }]
  };
  const comet = await deploymentManager.deploy<Comet, Comet__factory, [ConfigurationStruct]>(
    'Comet.sol',
    [cometArg]
  );
  if (verify) {
    await verifyContract(hre, comet.address, [cometArg]);
  }
  console.log('Comet deployed to:', comet.address);

  console.log('Deploying proxy...');
  let proxyArgs: [string, string, []] = [comet.address, governor.address, []];
  const proxy = await deploymentManager.deploy<
    TransparentUpgradeableProxy,
    TransparentUpgradeableProxy__factory,
    [string, string, []]
  >('asteroid/vendor/proxy/TransparentUpgradeableProxy.sol', proxyArgs);
  if (verify) {
    await verifyContract(hre, proxy.address, proxyArgs);
  }
  console.log('Proxy deployed to:', proxy.address);

  await deploymentManager.setRoots({ Comet: comet.address } as Roots);

  return {
    comet,
    oracle,
    proxy,
  };
}
