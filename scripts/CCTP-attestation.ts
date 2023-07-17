/*
 A script to help check if CCTP's attestation server to acquire signature to mint native USDC on arbitrum
 To run: DEPLOYMENT=usdc BURN_TXN_HASH=0xc36edf38fe324b7a35a9d267d77d86feb542ce411060be6cd22d648cead7fb04 npx hardhat run scripts/CCTP-attestation.ts --network mainnet
*/
import hre from 'hardhat';
import { DeploymentManager } from '../plugins/deployment_manager/DeploymentManager';
import { default as config, requireEnv } from '../hardhat.config';

async function main() {
  const DEPLOYMENT = requireEnv('DEPLOYMENT');
  const BURN_TXN_HASH = requireEnv('BURN_TXN_HASH');
  const network = hre.network.name;
  const dm = new DeploymentManager(network, DEPLOYMENT, hre, {
    writeCacheToDisk: true
  });
  await dm.spider();

  const transactionReceipt = await dm.hre.ethers.provider.getTransactionReceipt(BURN_TXN_HASH);
  const eventTopic = dm.hre.ethers.utils.id('MessageSent(bytes)');
  const log = transactionReceipt.logs.find((l) => l.topics[0] === eventTopic);
  const messageBytes = dm.hre.ethers.utils.defaultAbiCoder.decode(['bytes'], log.data)[0];
  const messageHash = dm.hre.ethers.utils.keccak256(messageBytes);
  console.log(`Message hash: ${messageHash}`);
  let attestationResponse = { status: 'pending', attestation: ''};
  while (attestationResponse.status != 'complete') {
    console.log(`Polling... https://iris-api.circle.com/attestations/${messageHash}`)
    const response = await fetch(`https://iris-api.circle.com/attestations/${messageHash}`);
    attestationResponse = await response.json();
    console.log(`Response: ${JSON.stringify(attestationResponse)}`);
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('Attestation complete! Please go invoke receiveMessage on targeted L2 CCTP\'s MessageTransmitterContract with the following to mint native USDC to destination:');
  console.log(`receivingMessageBytes: ${messageBytes}`);
  console.log(`signature: ${attestationResponse.attestation}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
