import {SafeAccountConfig, SafeFactory} from '@safe-global/protocol-kit';
import {ethers} from 'hardhat';

async function deploySafe(owners:string[], threshold:number, salt:string){
  const [deployer] = await ethers.getSigners();
  console.log('Deploying safe with the account:', deployer.address);
  const balance = await deployer.getBalance();
  console.log("Account balance:", ethers.utils.formatEther(balance));
  const network = await ethers.provider.getNetwork();
  console.log('Network:', network);
  let rpcUrl: string;
  if (network.chainId === 11155420) {
    rpcUrl = process.env.OP_SEPOLIA_RPC!;
  } else if (network.chainId === 421614) {
    rpcUrl = process.env.ARB_SEPOLIA_RPC!;
  } else if (network.chainId === 11155111) {
    rpcUrl = process.env.ETH_SEPOLIA_RPC!;
  } else {
    throw new Error('Unsupported network');
  }
  
  let signer;
  if (process.env.PRIVATE_KEY) {
    signer = process.env.PRIVATE_KEY;
  } else{
    throw new Error('Signer private key not available in env');
  }

  const safeFactory = await SafeFactory.init({ provider: rpcUrl, signer: signer, safeVersion:'1.4.1' });

  const safeAccountConfig: SafeAccountConfig = {
    owners:[deployer.address, ...owners],
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
  
  
  const owners = ['0x7053e25f7076F4986D632A3C04313C81831e0d55', '0x77B65c68E52C31eb844fb3b4864B91133e2C1308']; // Replace with actual addresses
  const threshold = 2; // Require 2 out of 3 approvals
  const salt = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('deterministic-safe-8'));

  const {safe} = await deploySafe(owners, threshold, salt);
  const safeBalance = await safe.getBalance();
  console.log('Safe balance:', safeBalance.toString());
  
  const chainId = await safe.getChainId();
  console.log('Safe chainId:', chainId);
  
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
