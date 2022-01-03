// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import hre from 'hardhat';
import {
  AsteroidRaffle__factory,
  AsteroidRaffle,
  FaucetToken__factory,
  FaucetToken,
  MockedOracle__factory,
  TransparentUpgradeableProxy__factory,
} from '../build/types';
import {
  DeploymentManager,
  Roots,
} from '../plugins/deployment_manager/DeploymentManager';

async function verifyContract(address: string, constructorArguments) {
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

async function main() {
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
  await verifyContract(token.address, tokenArgs);
  console.log('FaucetToken deployed to:', token.address);

  const Oracle = (await hre.ethers.getContractFactory(
    'MockedOracle'
  )) as MockedOracle__factory;
  const oracle = await Oracle.connect(governor).deploy();
  await oracle.deployed();
  await verifyContract(oracle.address, []);
  console.log('Oracle deployed to:', oracle.address);

  const AsteroidRaffle = (await hre.ethers.getContractFactory(
    'AsteroidRaffle'
  )) as AsteroidRaffle__factory;
  const raffleArgs: [string, string] = [token.address, oracle.address];
  const raffle = await AsteroidRaffle.deploy(...raffleArgs);
  await raffle.deployed();
  await verifyContract(raffle.address, raffleArgs);
  console.log('Raffle deployed to:', raffle.address);

  const tx1 = await raffle.initialize('100000000000000000', 3 * 60);
  await tx1.wait();

  const Proxy = (await hre.ethers.getContractFactory(
    'TransparentUpgradeableProxy'
  )) as TransparentUpgradeableProxy__factory;
  const proxyArgs: [string, string, []] = [
    raffle.address,
    governor.address,
    [],
  ];
  const proxy = await Proxy.deploy(...proxyArgs);
  await proxy.deployed();
  await verifyContract(proxy.address, proxyArgs);
  console.log('Proxy deployed to:', proxy.address);

  // Create a `roots.json` pointing to a just deployed contract and run spider on it.
  let dm = new DeploymentManager(hre.network.name, hre, {
    writeCacheToDisk: true,
  });
  await dm.writeRootsFileToCache({ AsteroidRaffle: raffle.address } as Roots);
  await dm.spider();
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
