import {SafeAccountConfig, SafeFactory} from '@safe-global/protocol-kit';
import {ethers} from 'hardhat';

async function deploySafe(owners:string[], threshold:number, salt:string, chainId: number){
  let rpcUrl: string;
  switch (chainId) {
    case 11155420: // Optimism Sepolia
      rpcUrl = process.env.OP_SEPOLIA_RPC!;
      break;
    case 421614: // Arbitrum Sepolia
      rpcUrl = process.env.ARB_SEPOLIA_RPC!;
      break;
    case 11155111: // Ethereum Sepolia
      rpcUrl = process.env.ETH_SEPOLIA_RPC!;
      break;
    case 1: // Ethereum Mainnet
      rpcUrl = process.env.ETH_MAINNET_RPC!;
      break;
    case 137: // Polygon Mainnet
      rpcUrl = process.env.POLYGON_MAINNET_RPC!;
      break;
    case 8453: // Base Mainnet
      rpcUrl = process.env.BASE_MAINNET_RPC!;
      break;
    case 10: // Optimism Mainnet
      rpcUrl = process.env.OP_MAINNET_RPC!;
      break;
    case 42161: // Arbitrum Mainnet
      rpcUrl = process.env.ARB_MAINNET_RPC!;
      break;
    case 534352: // Scroll Mainnet
      rpcUrl = process.env.SCROLL_MAINNET_RPC!;
      break;
    default:
      throw new Error('Unsupported chain ID');
  }
  
  let signer;
  if (process.env.PRIVATE_KEY) {
    signer = process.env.PRIVATE_KEY;
  } else{
    throw new Error('Signer private key not available in env');
  }

  const safeFactory = await SafeFactory.init({ provider: rpcUrl, signer: signer, safeVersion:'1.4.1' });

  const safeAccountConfig: SafeAccountConfig = {
    owners:[...owners],
    threshold: threshold
  };

  console.log('Predicting safe address..');
  const predictedDeployAddress = await safeFactory.predictSafeAddress(safeAccountConfig,salt);
  console.log('Predicted deployed address:', predictedDeployAddress);
   
  const safe = await safeFactory.deploySafe({ safeAccountConfig: safeAccountConfig, saltNonce: salt });
  const safeAddress = await safe.getAddress();
  console.log('Safe deployed at:', safeAddress);
  
  return {safe, safeAddress};
}
async function main() {
  
  
  const owners = JSON.parse(process.env.OWNERS || '[]');
  const threshold = parseInt(process.env.THRESHOLD || '0', 10);
  const chainId = parseInt(process.env.CHAIN_ID || '0', 10);

  if (chainId <= 0) {
    throw new Error(
      'Invalid chain ID. Please provide a positive integer for the CHAIN_ID environment variable.'
    );
  }

  if (owners.length === 0) {
    throw new Error(
      "No owners provided. Please pass the owners' addresses as a JSON array in the OWNERS environment variable."
    );
  }

  if (threshold <= 0) {
    throw new Error(
      'Invalid threshold value. Please provide a positive integer for the THRESHOLD environment variable.'
    );
  }

  const salt = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('deterministic-safe-11'));

  const {safe} = await deploySafe(owners, threshold, salt, chainId);
  const safeBalance = await safe.getBalance();
  console.log('Safe balance:', safeBalance.toString());
  
  const chainIdFromSafe = await safe.getChainId();
  console.log('Safe chainId:', chainIdFromSafe);
  
  // loading already deployed safe
  
  // const predictedSafe: PredictedSafeProps = {
  //   safeAccountConfig,
  //   safeDeploymentConfig
  // };
  
  // const protocolKit = await Safe.init({
  //   provider,
  //   signer,
  //   safeAddress
  // });

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
