// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import hre from 'hardhat';

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // We get the contract to deploy
  const Protocol = await hre.ethers.getContractFactory('ProtocolUnoptimized');
  const protocol = await Protocol.deploy();

  await protocol.deployed();

  await hre.tenderly.persistArtifacts({
    name: "Protocol",
    address:protocol.address
  });

  console.log('Protocol deployed to:', protocol.address);

  const [user, asset] = await hre.ethers.getSigners();

  const setUserTx = await protocol.setUser(user.address, 1, 1, 1, 1);
  await setUserTx.wait();

  const setAssetTx = await protocol.setAsset(asset.address, 1, 1);
  await setAssetTx.wait();

  const experimentTx = await protocol.experiment();
  await experimentTx.wait();
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
