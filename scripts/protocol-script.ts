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
  const Protocol = await hre.ethers.getContractFactory('Protocol');
  const protocol = await Protocol.deploy();

  await protocol.deployed();

  await hre.tenderly.persistArtifacts({
    name: "Protocol",
    address: protocol.address
  });

  console.log('Protocol deployed to:', protocol.address);

  const [user, asset] = await hre.ethers.getSigners();

  const setUserTx = await protocol.setUser(user.address, 1, 1, 1, 1);
  await setUserTx.wait();

  const setAssetTx = await protocol.setAsset(asset.address, 1, 1);
  await setAssetTx.wait();

  // Measure gas for this transaction
  const totalsTx = await protocol.setTotals();
  await totalsTx.wait();

  const accrue1Tx = await protocol.accrue1();
  await accrue1Tx.wait();

  // Count SLOADS and SSTORES for this transaction
  const accrue1Trace = await hre.network.provider.send("debug_traceTransaction", [
    accrue1Tx.hash,
  ]);
  let sstoreCount1 = 0
  let sloadCount1 = 0
  accrue1Trace.structLogs.forEach(elem => {
    if (elem.op == 'SSTORE') {
      sstoreCount1++;
      // console.log("Elem = ", elem);
    } else if (elem.op == 'SLOAD') {
      sloadCount1++;
      // console.log("Elem = ", elem);
    }
  });
  console.log("TOTALS SSTORE count = ", sstoreCount1);
  console.log("TOTALS SLOAD count = ", sloadCount1);

  const totals2Tx = await protocol.setTotals();
  await totals2Tx.wait();

  const accrue2Tx = await protocol.accrue2();
  await accrue2Tx.wait();
  // Count SLOADS and SSTORES for this transaction
  const accrue2Trace = await hre.network.provider.send("debug_traceTransaction", [
    accrue2Tx.hash,
  ]);
  let sstoreCount2 = 0
  let sloadCount2 = 0
  accrue2Trace.structLogs.forEach(elem => {
    if (elem.op == 'SSTORE') {
      sstoreCount2++;
      // console.log("Elem = ", elem);
    } else if (elem.op == 'SLOAD') {
      sloadCount2++;
      // console.log("Elem = ", elem);

    }
  });
  console.log("TOTALS SSTORE count = ", sstoreCount2);
  console.log("TOTALS SLOAD count = ", sloadCount2);

  const totals3Tx = await protocol.setTotals();
  await totals3Tx.wait();

  const accrue3Tx = await protocol.accrue3();
  await accrue3Tx.wait();
  // Count SLOADS and SSTORES for this transaction
  const accrue3Trace = await hre.network.provider.send("debug_traceTransaction", [
    accrue3Tx.hash,
  ]);
  let sstoreCount3 = 0
  let sloadCount3 = 0
  accrue3Trace.structLogs.forEach(elem => {
    if (elem.op == 'SSTORE') {
      sstoreCount3++;
      // console.log("Elem = ", elem);
    } else if (elem.op == 'SLOAD') {
      sloadCount3++;
      // console.log("Elem = ", elem);
    }
  });
  console.log("TOTALS SSTORE count = ", sstoreCount3);
  console.log("TOTALS SLOAD count = ", sloadCount3);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
