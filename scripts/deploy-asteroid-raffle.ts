// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import hre from 'hardhat';
import { DeploymentManager, Roots } from '../plugins/deployment_manager/DeploymentManager';

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  const [governor, user1] = await hre.ethers.getSigners();
  console.log('governor address = ', governor.address);

  const FaucetToken = await hre.ethers.getContractFactory('FaucetToken');
  const token = await FaucetToken.deploy(100000, 'DAI', 18, 'DAI');
  await token.deployed();
  await hre.run("verify:verify", {
    address: token.address,
    constructorArguments: [
      100000,
      'DAI',
      18,
      'DAI',
    ],
  });
  console.log('FaucetToken deployed to:', token.address);

  const Oracle = await hre.ethers.getContractFactory('MockedOracle');
  const oracle = await Oracle.connect(governor).deploy();
  await oracle.deployed();
  await hre.run("verify:verify", {
    address: oracle.address,
  });
  console.log('Oracle deployed to:', oracle.address);

  const AsteroidRaffle = await hre.ethers.getContractFactory('AsteroidRaffle');
  const raffle = await AsteroidRaffle.deploy(token.address, oracle.address);
  await raffle.deployed();
  await hre.run("verify:verify", {
    address: raffle.address,
    constructorArguments: [
      token.address,
      oracle.address,
    ],
  });
  console.log('Raffle deployed to:', raffle.address);

  const tx1 = await raffle.initialize('100000000000000000', 3 * 60);
  await tx1.wait();

  const Proxy = await hre.ethers.getContractFactory('TransparentUpgradeableProxy');
  const proxy = await Proxy.deploy(raffle.address, governor.address, []);
  await proxy.deployed();
  await hre.run("verify:verify", {
    address: proxy.address,
    constructorArguments: [
      raffle.address,
      governor.address,
      [],
    ],
  });
  console.log('Proxy deployed to:', proxy.address);

  let dm = new DeploymentManager(hre.network.name, hre, { writeCacheToDisk: true });
  await dm.writeRootsFileToCache({ 'AsteroidRaffle': raffle.address } as Roots);
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
