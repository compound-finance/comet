// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from 'hardhat';

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // We get the contract to deploy
  const Configurator = await ethers.getContractFactory('Configurator');
  const configurator = await Configurator.deploy(100000, 200000);
  await configurator.deployed();
  console.log('Configurator deployed to:', configurator.address);

  const ProtocolFactory = await ethers.getContractFactory('ProtocolFactory');
  const protocolFactory = await ProtocolFactory.deploy(configurator.address);
  await protocolFactory.deployed();
  console.log('ProtocolFactory deployed to:', protocolFactory.address);

  const [admin] = await ethers.getSigners();
  console.log("admin = ", admin.address);


  // Get data from initial config
  const tx = await protocolFactory.createProtocol();
  const receipt = await tx.wait();
  console.log("protocol address = ", receipt.events[0].args.toString());
  const protocolAddress = receipt.events[0].args.toString();

  const protocol = await ethers.getContractAt("MockProtocol", protocolAddress);

  // Get data from protocol
  const targetReserves = await protocol.targetReserves();
  const borrowMin = await protocol.borrowMin();
  console.log("Target reserves = ", targetReserves.toString());
  console.log("Borrow min = ", targetReserves.toString());

}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
// await main();
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
