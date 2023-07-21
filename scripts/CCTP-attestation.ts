/*
 A script to help check if CCTP's attestation server to acquire signature to mint native USDC on arbitrum
 Example: 
 DEPLOYMENT=usdc BURN_TXN_HASH=<burn_txn_hash> SOURCE_NETWORK=goerli DEST_NETWORK=arbitrum-goerli ETH_PK=<private_key> npx hardhat run scripts/CCTP-attestation.ts
*/
import hre from 'hardhat';
import { DeploymentManager } from '../plugins/deployment_manager/DeploymentManager';
import { requireEnv } from '../hardhat.config';

async function main() {
  const DEPLOYMENT = requireEnv('DEPLOYMENT');
  const BURN_TXN_HASH = requireEnv('BURN_TXN_HASH');
  const SOURCE_NETWORK = requireEnv('SOURCE_NETWORK');
  const DEST_NETWORK = requireEnv('DEST_NETWORK');
  await hre.changeNetwork(SOURCE_NETWORK);
  const src_dm = new DeploymentManager(SOURCE_NETWORK, DEPLOYMENT, hre, {
    writeCacheToDisk: true
  });

  const circleAttestationApiHost = SOURCE_NETWORK === 'mainnet' ? 'https://iris-api.circle.com' : 'https://iris-api-sandbox.circle.com';
  const transactionReceipt = await src_dm.hre.ethers.provider.getTransactionReceipt(BURN_TXN_HASH);
  const eventTopic = src_dm.hre.ethers.utils.id('MessageSent(bytes)');
  const log = transactionReceipt.logs.find((l) => l.topics[0] === eventTopic);
  const messageBytes = src_dm.hre.ethers.utils.defaultAbiCoder.decode(['bytes'], log.data)[0];
  const messageHash = src_dm.hre.ethers.utils.keccak256(messageBytes);
  console.log(`Message hash: ${messageHash}`);
  let attestationResponse = { status: 'pending', attestation: ''};
  while (attestationResponse.status != 'complete') {
    console.log(`Polling... ${circleAttestationApiHost}/attestations/${messageHash}`);
    const response = await fetch(`${circleAttestationApiHost}/attestations/${messageHash}`);
    attestationResponse = await response.json();
    console.log(`Response: ${JSON.stringify(attestationResponse)}`);
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`Attestation complete, proceeding to mint native usdc on ${DEST_NETWORK}:`);
  console.log(`------Parameters value------`);
  console.log(`receivingMessageBytes: ${messageBytes}`);
  console.log(`signature: ${attestationResponse.attestation}`);
  console.log(`----------------------------`);
  await hre.changeNetwork(DEST_NETWORK);
  const dest_dm = new DeploymentManager(DEST_NETWORK, DEPLOYMENT, hre, {
    writeCacheToDisk: true
  });

  const CCTPMessageTransmitter = await dest_dm.getContractOrThrow('CCTPMessageTransmitter');
  const signer = await dest_dm.getSigner();
  const transactionRequest = await signer.populateTransaction({
    to: CCTPMessageTransmitter.address,
    from: signer.address,
    data: CCTPMessageTransmitter.interface.encodeFunctionData('receiveMessage', [messageBytes, attestationResponse.attestation]),
    gasPrice: Math.ceil(1.3 * (await hre.ethers.provider.getGasPrice()).toNumber())
  });

  const mintTxn = await signer.sendTransaction(transactionRequest);

  console.log(`Mint completed, transaction hash: ${mintTxn.hash}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
