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

  const [governor, user1] = await ethers.getSigners();

  // We get the contract to deploy
  const FaucetToken = await ethers.getContractFactory('FaucetToken');
  const token = await FaucetToken.deploy(100000, "DAI", 18, "DAI");
  await token.deployed();
  console.log('FaucetToken deployed to:', token.address);

  const Oracle = await ethers.getContractFactory('MockedOracle');
  const oracle = await Oracle.connect(governor).deploy();
  await oracle.deployed();
  console.log('Oracle deployed to:', oracle.address);

  const AsteroidRaffle = await ethers.getContractFactory('AsteroidRaffle');
  const raffle = await AsteroidRaffle.deploy('100000000000000000', token.address, oracle.address);
  await raffle.deployed();
  console.log('Raffle deployed to:', raffle.address);

  const tx1 = await raffle.connect(user1).enterWithEth({ value: ethers.utils.parseEther("0.1")});
  await tx1.wait();

  const tx2 = await raffle.determineWinner();
  await tx2.wait();
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
