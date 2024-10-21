import {SafeAccountConfig, SafeFactory} from '@safe-global/protocol-kit';
import {ethers} from 'hardhat';

async function deploySafe(owners:string[], threshold:number, salt:string, chainId: number){
  const rpcUrls = {
    11155420: process.env.OP_SEPOLIA_RPC, // Optimism Sepolia
    421614: process.env.ARB_SEPOLIA_RPC, // Arbitrum Sepolia
    11155111: process.env.ETH_SEPOLIA_RPC, // Ethereum Sepolia
    1: process.env.ETH_MAINNET_RPC, // Ethereum Mainnet
    137: process.env.POLYGON_MAINNET_RPC, // Polygon Mainnet
    8453: process.env.BASE_MAINNET_RPC, // Base Mainnet
    10: process.env.OP_MAINNET_RPC, // Optimism Mainnet
    42161: process.env.ARB_MAINNET_RPC, // Arbitrum Mainnet
    534352: process.env.SCROLL_MAINNET_RPC, // Scroll Mainnet
    5000: process.env.MANTLE_RPC_URL, // Mantle Mainnet
  };
  
  const rpcUrl = rpcUrls[chainId];
  
  if (!rpcUrl) {
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

  console.log('Deploying safe with config:', safeAccountConfig);

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
  const threshold = parseInt(process.env.THRESHOLD || '1', 10);
  const chainId = parseInt(process.env.CHAIN_ID || '0', 10);
  const saltString = process.env.SALT || '';
  
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

  if (threshold <= 1) {
    throw new Error(
      'Invalid threshold value. Please provide a positive integer for the THRESHOLD environment variable.'
    );
  }
  
  if (saltString == '') {
    throw new Error(
      'Invalid salt value. Please provide a salt for the SALT environment variable.'
    );
  }
  
  const salt = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(saltString));

  const {safe} = await deploySafe(owners, threshold, salt, chainId);
  
  const chainIdFromSafe = await safe.getChainId();
  console.log('Deployed safe chainId:', chainIdFromSafe);
  
  const safeOwners = await safe.getOwners();
  console.log('Deployed safe owners:', safeOwners);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
