import {ICreate2Deployer} from './../../build/types';
import hre, {ethers} from 'hardhat';
import { SafeFactory, SafeAccountConfig } from '@safe-global/protocol-kit';

async function deploySafe(owners:string[], threshold:number, salt:string){
  const [deployer] = await ethers.getSigners();
  console.log('Deploying safe with the account:', deployer.address);

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

async function createBytecode(create2Deployer:ICreate2Deployer, contract:string, salt:string, args?:any[]){
  const contractFactory = await ethers.getContractFactory(contract);
  
  let creationBytecode;
  if (args && args.length > 0) {
    creationBytecode = await contractFactory.getDeployTransaction(...args);
  } else {
    creationBytecode = await contractFactory.getDeployTransaction();
  }
  const artifact = hre.artifacts.readArtifact(contract);
  const bytecode = (await artifact).bytecode;
  const deployedByteCode = (await artifact).deployedBytecode;
  
  const computedAddress = await create2Deployer.computeAddress(salt, ethers.utils.keccak256(bytecode));

  return {computedAddress, creationBytecode, deployedByteCode};
}

async function checkAndDeploy(create2Deployer: ICreate2Deployer, salt: string, contractName: string, args?: any[]) {
  // Create bytecode and compute the deterministic address
  const { computedAddress, creationBytecode, deployedByteCode } = await createBytecode(create2Deployer, contractName, salt, args);

  console.log(`Deterministic Address of ${contractName}:`, computedAddress);

  // Check if the contract is already deployed
  const deployedCode = await ethers.provider.getCode(computedAddress);

  if (deployedCode !== '0x') {
    const contract = await ethers.getContractAt(contractName, computedAddress);
    const contractByteCode = await ethers.provider.getCode(contract.address);
    console.log(`${contractName} already deployed at address: `, computedAddress);
    console.log(`${contractName} ByteCode is Same? : `, contractByteCode.toLowerCase() === deployedByteCode.toLowerCase());
    return {contract, computedAddress};
  } else {
    // Deploy using CREATE2 if not already deployed
    console.log(`Deploying ${contractName}...`);
    await create2Deployer.deploy(0, salt, creationBytecode.data); // value = 0 for no ether transfer
    console.log(`Deployed ${contractName} at address (deterministic):`, computedAddress);
    return {contract: await ethers.getContractAt(contractName, computedAddress), computedAddress };
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying contracts with the account:', deployer.address);
  const balance = await deployer.getBalance();
  console.log('Account balance:', balance.toString());

  const salt = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('Salt-15'));
  console.log('salt: ', salt);
  const owners = ['0x7053e25f7076F4986D632A3C04313C81831e0d55', '0x77B65c68E52C31eb844fb3b4864B91133e2C1308']; // Replace with actual addresses
  const threshold = 2; // Require 2 out of 3 approvals
  
  // Get the Create2 Deployer contract at its known address
  const create2DeployerAddress = '0x13b0D85CcB8bf860b6b79AF3029fCA081AE9beF2';
  const create2Deployer = (await ethers.getContractAt(
    'ICreate2Deployer',
    create2DeployerAddress
  )) as ICreate2Deployer;

  const governorTimelockAddr = '0x6d903f6003cca6255D85CcA4D3B5E5146dC33925';
  const pauseGuardianAddr = '0x7053e25f7076F4986D632A3C04313C81831e0d55';

  const {safeAddress: multisigAddress} = await deploySafe(owners,threshold,salt);

  const delay = 2 * 24 * 60 * 60; // This is 2 days in seconds
  const marketTimelockArgs = [governorTimelockAddr, delay]; 
  const {contract:marketUpdateTimelock, computedAddress:marketUpdateTimelockAddress} = await checkAndDeploy(create2Deployer, salt, 'MarketUpdateTimelock', marketTimelockArgs);
  
  const marketProposerArgs = [governorTimelockAddr,multisigAddress,pauseGuardianAddr,marketUpdateTimelockAddress];
  const {contract:marketUpdateProposer, computedAddress: marketProposerAddress} = await checkAndDeploy(create2Deployer, salt, 'MarketUpdateProposer', marketProposerArgs);
  
  const {contract:configurator, computedAddress: configuratorAddress} = await checkAndDeploy(create2Deployer, salt, 'Configurator');

  const {contract:cometProxyAdmin, computedAddress: cometProxyAdminAddress} = await checkAndDeploy(create2Deployer, salt, 'CometProxyAdmin');

  console.log('Computed Contract Addresses:', {
    multisigAddress,
    marketUpdateTimelockAddress,
    marketProposerAddress,
    configuratorAddress,
    cometProxyAdminAddress
  });

  console.log('Deployed Contracts Addresses:', {
    marketUpdateTimelock: marketUpdateTimelock.address,
    marketUpdateProposer: marketUpdateProposer.address,
    configurator: configurator.address,
    cometProxyAdmin: cometProxyAdmin.address
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
