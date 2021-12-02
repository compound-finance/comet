// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from 'hardhat';

// Use simple ConfigFactory for generation of config contracts
async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // We get the contract to deploy
  const ConfigFactory = await ethers.getContractFactory('ConfigFactory');
  const configFactory = await ConfigFactory.deploy();
  await configFactory.deployed();
  console.log('Config Factory deployed to:', configFactory.address);

  // Deploy new config
  const config1Tx = await configFactory.createConfig(100000, 200000);
  const config1Receipt = await config1Tx.wait();
  const config1Address = config1Receipt.events[0].args.toString()
  console.log("Config1 address = ", config1Address);

  // Deploy new config
  const config2Tx = await configFactory.createConfig(300000, 400000);
  const config2Receipt = await config2Tx.wait();
  const config2Address = config2Receipt.events[0].args.toString()
  console.log("Config2 address = ", config2Address);

  const [admin] = await ethers.getSigners();
  console.log("admin = ", admin.address);

  const Proxy = await ethers.getContractFactory('TransparentUpgradeableProxy');
  const proxy = await Proxy.deploy(config1Address, admin.address, []);
  await proxy.deployed();
  console.log('Proxy deployed to:', proxy.address);

  const Protocol = await ethers.getContractFactory('Protocol');
  const protocol = await Protocol.deploy(proxy.address);
  await protocol.deployed();
  console.log('Protocol deployed to:', protocol.address);

  // Get data from initial config
  const tx = await protocol.getData();
  const receipt = await tx.wait();
  console.log("Data with config 1 = ", receipt.events[0].args.toString());

  // Upgrade proxy to the new config contract
  const upgradeTx = await proxy.connect(admin).upgradeTo(config2Address);
  await upgradeTx.wait();

  // Get data from the new config
  const tx2 = await protocol.getData();
  const receipt2 = await tx2.wait();
  console.log("Data with config 2 = ", receipt2.events[0].args.toString());
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
