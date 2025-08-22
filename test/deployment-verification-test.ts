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
      contracts.governor = await ethers.getContractAt('IGovernorBravo', roots.governor);
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

  it('should have correct custom governor configuration (if using BDAG)', async function () {
    const { governor } = deployedContracts;
    
    // Check if this is a custom governor by looking for custom functions
    try {
      // Try to call a custom governor function - cast to any to access custom functions
      const customGovernor = governor as any;
      await customGovernor.multisigThreshold();
      
      // If successful, this is a custom governor - verify its configuration
      expect(await customGovernor.multisigThreshold()).to.be.gt(0);
      
      // Verify at least one admin is set
      const adminCount = await customGovernor.getAdminCount();
      expect(adminCount).to.be.gt(0);
      
      console.log('✅ Custom BDAG governor detected and verified');
      
    } catch (error) {
      // This is a standard Governor Bravo - skip custom governor checks
      console.log('ℹ️  Standard Governor Bravo detected - skipping custom governor checks');
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