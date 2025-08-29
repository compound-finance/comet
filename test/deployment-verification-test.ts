import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import { Contract } from 'ethers';

describe('Deployment Verification', function () {
  // This test verifies the deployment configuration for any network/market
  // export MARKET=dai && yarn hardhat test test/deployment-verification-test.ts --network local
  let deployedContracts: any;
  let market: string;

  before(async function () {
    // Get network from hardhat
    const networkName = network.name;
    
    // Get market from environment variable or throw error
    market = process.env.MARKET;
    
    if (!market) {
      throw new Error('❌ MARKET environment variable is required. Usage: export MARKET=dai && yarn hardhat test test/deployment-verification-test.ts --network local');
    }
    
    console.log(`🔍 Testing deployment on network: ${networkName}, market: ${market}`);
    
    // Load the deployed contracts from aliases.json
    const rootsPath = `../deployments/${networkName}/${market}/roots.json`;
    const roots = require(rootsPath);
    const contracts: any = {};
    
    // Load each contract from aliases
    if (roots.comet) {
      contracts.comet = await ethers.getContractAt('CometHarnessInterface', roots.comet);
    }
    if (roots.governor) {
      contracts.governor = await ethers.getContractAt('CustomGovernor', roots.governor);
    }
    if (roots.timelock) {
      contracts.timelock = await ethers.getContractAt('Timelock', roots.timelock);
    }
    if (roots.COMP) {
      contracts.COMP = await ethers.getContractAt('IComp', roots.COMP);
    }
    
    deployedContracts = contracts;
  });

  it('should have correct ownership relationships', async function () {
    const { comet, governor, timelock } = deployedContracts;
    
    // Verify timelock admin is set to governor
    expect(await timelock.admin()).to.equal(governor.address);
    
    // Verify comet governor is set correctly
    expect(await comet.governor()).to.equal(timelock.address);
    
    // Verify proxy admin ownership
    const proxyAdmin = await getProxyAdmin(comet.address);
    expect(await proxyAdmin.owner()).to.equal(timelock.address);
  });

  it('should have correct base token configuration', async function () {
    const { comet } = deployedContracts;
    
    // Verify base token is set correctly
    const baseToken = await comet.baseToken();
    expect(baseToken).to.not.equal(ethers.constants.AddressZero);
    
    // Verify base token price feed is set
    const baseTokenPriceFeed = await comet.baseTokenPriceFeed();
    expect(baseTokenPriceFeed).to.not.equal(ethers.constants.AddressZero);
  });

  it('should have correct asset configurations', async function () {
    const { comet } = deployedContracts;
    
    // Get number of assets
    const numAssets = await comet.numAssets();
    expect(numAssets).to.be.gt(0);
    
    // Verify each asset is properly configured
    for (let i = 0; i < numAssets; i++) {
      const assetInfo = await comet.getAssetInfo(i);
      
      // Verify asset is not zero address
      expect(assetInfo.asset).to.not.equal(ethers.constants.AddressZero);
      
      // Verify price feed is set
      expect(assetInfo.priceFeed).to.not.equal(ethers.constants.AddressZero);
      
      // Verify supply cap is greater than zero
      expect(assetInfo.supplyCap).to.be.gt(0);
    }
  });

  it('should validate BDAG governor environment configuration matches deployed contract', async function () {
    const { governor } = deployedContracts;
    const customGovernor = governor as any;
    
    const deployedThreshold = await customGovernor.multisigThreshold();
    
    // Get environment variables
    const envSigners = process.env.GOV_SIGNERS;
    const envThreshold = process.env.MULTISIG_THRESHOLD;
    
    if (!envSigners || !envThreshold) {
      throw new Error('GOV_SIGNERS and MULTISIG_THRESHOLD environment variables must be set for BDAG governor validation');
    }
    
    const envSignersArray = envSigners.split(',').map(s => s.trim());
    const envThresholdNum = parseInt(envThreshold);
    
    expect(envSignersArray.length).to.be.gt(0);
    expect(envThresholdNum).to.be.gt(0);
    expect(envThresholdNum).to.not.be.NaN;
    
    expect(deployedThreshold).to.equal(envThresholdNum);
    
    for (let i = 0; i < envSignersArray.length; i++) {
      const envAddress = envSignersArray[i];
      
      expect(ethers.utils.isAddress(envAddress)).to.be.true;
      
      const isAdmin = await customGovernor.admins(envAddress);
      expect(isAdmin).to.be.true;
    }
  });

  it('should validate BDAG timelock delay configuration matches deployed contract', async function () {
    const { timelock } = deployedContracts;
    
    // Get environment variable
    const envDelay = process.env.TIMELOCK_DELAY;
    
    if (!envDelay) {
      throw new Error('TIMELOCK_DELAY environment variable must be set for BDAG timelock validation');
    }
    
    const envDelayNum = parseInt(envDelay);
    
    // Validate environment variable
    expect(envDelayNum).to.not.be.NaN;
    expect(envDelayNum).to.be.gte(0);
    
    // Get deployed timelock delay
    const deployedDelay = await timelock.delay();
    
    // Verify deployed delay matches environment configuration
    expect(deployedDelay).to.equal(envDelayNum);
    
    // Additional validation: ensure delay is properly set
    expect(deployedDelay).to.be.gte(0);
    
    console.log(`✅ Timelock delay validation passed: ${deployedDelay} seconds (${envDelayNum} from env)`);
  });

  it('should validate BDAG governor admin addresses are not zero or contract address', async function () {
    const { governor } = deployedContracts;
    
    const customGovernor = governor as any;
    await customGovernor.multisigThreshold;
    
    const envSigners = process.env.GOV_SIGNERS;
    if (!envSigners) {
      throw new Error('GOV_SIGNERS environment variable not set');
    }
    
    const envSignersArray = envSigners.split(',').map(s => s.trim());
    
    for (let i = 0; i < envSignersArray.length; i++) {
      const adminAddress = envSignersArray[i];
      
      expect(adminAddress).to.not.equal(ethers.constants.AddressZero);
      
      expect(adminAddress).to.not.equal(governor.address);
      
      expect(ethers.utils.isAddress(adminAddress)).to.be.true;
    }
  });

  it('should have correct proxy implementation', async function () {
    const { comet } = deployedContracts;
    
    // Get proxy admin
    const proxyAdmin = await getProxyAdmin(comet.address);
    
    // Verify implementation is set
    const implementation = await proxyAdmin.getProxyImplementation(comet.address);
    expect(implementation).to.not.equal(ethers.constants.AddressZero);
    
    // Verify implementation is different from proxy address
    expect(implementation).to.not.equal(comet.address);
  });

  it('should have governor holding total COMP supply', async function () {
    const { governor, COMP } = deployedContracts;
    
    // Get total supply of COMP tokens
    const totalSupply = await COMP.totalSupply();
    expect(totalSupply).to.be.gt(0);
    
    // Get governor's balance of COMP tokens
    const governorBalance = await COMP.balanceOf(governor.address);
    expect(governorBalance).to.be.gt(0);
    
    // Verify governor holds the total supply
    expect(governorBalance).to.equal(totalSupply);
    
    console.log(`✅ Governor holds ${ethers.utils.formatEther(governorBalance)} COMP tokens (total supply)`);
  });
});

// Helper function to get proxy admin for a contract
async function getProxyAdmin(contractAddress: string): Promise<Contract> {
  // Try to get proxy admin using different methods
  try {
    // Method 1: Try to get admin directly from contract
    const contract = new Contract(
      contractAddress,
      ['function admin() external view returns (address)'],
      ethers.provider
    );
    const adminAddress = await contract.admin();
    
    return new Contract(
      adminAddress,
      [
        'function owner() external view returns (address)',
        'function getProxyImplementation(address) external view returns (address)'
      ],
      ethers.provider
    );
  } catch (error) {
    // Method 2: Try to get admin using storage slot
    const adminSlot = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
    const adminAddress = await ethers.provider.getStorageAt(contractAddress, adminSlot);
    
    return new Contract(
      ethers.utils.getAddress(adminAddress.slice(26)), // Remove padding
      [
        'function owner() external view returns (address)',
        'function getProxyImplementation(address) external view returns (address)'
      ],
      ethers.provider
    );
  }
} 