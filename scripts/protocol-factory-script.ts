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

  const [admin, alice] = await ethers.getSigners();
  console.log("admin = ", admin.address);

  // Get data from initial config
  const tx = await protocolFactory.createProtocol();
  const receipt = await tx.wait();
  const protocolAddress = receipt.events[0].args.toString();
  const protocol = await ethers.getContractAt("MockProtocol", protocolAddress);

  const Proxy = await ethers.getContractFactory('TransparentUpgradeableProxy');
  const proxy = await Proxy.deploy(protocol.address, admin.address, []);
  await proxy.deployed();
  console.log('Proxy deployed to:', proxy.address);

  const abi = [
    "function getTargetReserves() public view returns (uint)",
    "function getBorrowMin() public view returns (uint)",
    "function getData() public returns (uint, uint)"
  ];

  const proxied = new ethers.Contract(proxy.address, abi, alice);

  const totalReserves = await proxied.getTargetReserves();
  const borrowMin = await proxied.getBorrowMin();
  console.log("Target reserves = ", totalReserves.toString());
  console.log("Borrow min = ", borrowMin.toString());

  const tx2 = await configurator.setTargetReserves(800);
  await tx2.wait();

  const upgradeTx = await protocolFactory.createProtocol();
  const upgradeReceipt = await upgradeTx.wait();
  const upgradeAddress = upgradeReceipt.events[0].args.toString();
  const proxyUpgradeTx = await proxy.connect(admin).upgradeTo(upgradeAddress);
  await proxyUpgradeTx.wait();

  const totalReserves2 = await proxied.getTargetReserves();
  const borrowMin2 = await proxied.getBorrowMin();
  console.log("Target reserves after upgrade = ", totalReserves2.toString());
  console.log("Borrow min after upgrade = ", borrowMin2.toString());
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
