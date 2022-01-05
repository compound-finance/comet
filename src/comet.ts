import { HardhatRuntimeEnvironment } from 'hardhat/types';
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
export { Comet } from '../build/types';

async function verifyContract(hre: HardhatRuntimeEnvironment, address: string, constructorArguments) {
  try {
    return await hre.run('verify:verify', {
      address,
      constructorArguments,
    });
  } catch (e) {
    const regex = /Already Verified/i;
    const result = e.message.match(regex);
    if (result) {
      console.log(
        'Contract at address ' + address + ' is already verified on Etherscan'
      );
      return;
    }
    throw e;
  }
}

export async function deploy(hre: HardhatRuntimeEnvironment, verify: boolean = false): Promise<{comet: Comet, oracle: MockedOracle, proxy: TransparentUpgradeableProxy}> {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  const [governor, user1] = await hre.ethers.getSigners();

  const FaucetToken = (await hre.ethers.getContractFactory(
    'FaucetToken'
  )) as FaucetToken__factory;
  const tokenArgs: [number, string, number, string] = [
    100000,
    'DAI',
    18,
    'DAI',
  ];
  const token = await FaucetToken.deploy(...tokenArgs);
  await token.deployed();
  if (verify) {
    await verifyContract(hre, token.address, tokenArgs);
  }
  console.log('FaucetToken deployed to:', token.address);

  const Oracle = (await hre.ethers.getContractFactory(
    'MockedOracle'
  )) as MockedOracle__factory;
  const oracle = await Oracle.connect(governor).deploy();
  await oracle.deployed();
  if (verify) {
    await verifyContract(hre, oracle.address, []);
  }
  console.log('Oracle deployed to:', oracle.address);

  const Comet = (await hre.ethers.getContractFactory(
    'Comet'
  )) as Comet__factory;
  const cometArg = { governor: await governor.getAddress(), priceOracle: oracle.address, baseToken: token.address };
  const comet = await Comet.deploy(cometArg);
  await comet.deployed();
  if (verify) {
    await verifyContract(hre, comet.address, [cometArg]);
  }
  console.log('Comet deployed to:', comet.address);

  const Proxy = (await hre.ethers.getContractFactory(
    'TransparentUpgradeableProxy'
  )) as TransparentUpgradeableProxy__factory;
  const proxyArgs: [string, string, []] = [
    comet.address,
    governor.address,
    [],
  ];
  const proxy = await Proxy.deploy(...proxyArgs);
  await proxy.deployed();
  if (verify) {
    await verifyContract(hre, proxy.address, proxyArgs);
  }
  console.log('Proxy deployed to:', proxy.address);

  return {
    comet,
    oracle,
    proxy
  };
}
