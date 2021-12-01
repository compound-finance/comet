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
  const Config = await ethers.getContractFactory('Config');
  const config = await Config.deploy(100000, 200000);
  await config.deployed();
  console.log('Config deployed to:', config.address);

  const [admin] = await ethers.getSigners();
  console.log("admin = ", admin.address);

  const Proxy = await ethers.getContractFactory('TransparentUpgradeableProxy');
  const proxy = await Proxy.deploy(config.address, admin.address, []);
  await proxy.deployed();
  console.log('Proxy deployed to:', proxy.address);

  const Protocol = await ethers.getContractFactory('Protocol');
  const protocol = await Protocol.deploy(proxy.address);
  await protocol.deployed();
  console.log('Protocol deployed to:', protocol.address);

  const tx = await protocol.getData();
  const receipt = await tx.wait();
  console.log("Events = ", receipt.events[0].args.toString());
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
