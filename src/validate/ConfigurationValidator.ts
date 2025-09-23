import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { ContractMap } from '../../plugins/deployment_manager/ContractMap';
import { NetworkConfiguration } from '../deploy/NetworkConfiguration';

// Constants from CometCore.sol
const MAX_ASSETS = 15;
const MAX_BASE_DECIMALS = 18;
const MAX_COLLATERAL_FACTOR = 1e18; // FACTOR_SCALE
const PRICE_FEED_DECIMALS = 8;
const BASE_ACCRUAL_SCALE = 1e6;
const FACTOR_SCALE = 1e18;

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export async function validateConfiguration(
  config: NetworkConfiguration,
  contracts: ContractMap,
  hre: HardhatRuntimeEnvironment
): Promise<ValidationResult> {
  const errors: string[] = [];

  try {
    // Validate base token decimals
    await validateBaseTokenDecimals(config, contracts, errors, hre);

    // Validate store front price factor
    validateStoreFrontPriceFactor(config, errors);

    // Validate number of assets
    validateNumberOfAssets(config, errors);

    // Validate base min for rewards
    validateBaseMinForRewards(config, errors);

    // Validate base token price feed decimals
    await validateBaseTokenPriceFeedDecimals(config, contracts, errors, hre);

    // Validate base scale vs BASE_ACCRUAL_SCALE
    await validateBaseScale(config, contracts, errors, hre);

    // Validate each asset configuration
    await validateAssetConfigurations(config, contracts, errors, hre);

  } catch (error) {
    errors.push(`Validation error: ${error.message}`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

async function validateBaseTokenDecimals(
  config: NetworkConfiguration,
  contracts: ContractMap,
  errors: string[],
  hre: HardhatRuntimeEnvironment
): Promise<void> {
  try {
    const baseTokenAddress = getContractAddress(config.baseToken, contracts, config.baseTokenAddress);
    const baseToken = await hre.ethers.getContractAt('IERC20NonStandard', baseTokenAddress);
    const decimals = await baseToken.decimals();
    
    if (decimals > MAX_BASE_DECIMALS) {
      errors.push(`Base token decimals (${decimals}) exceeds maximum allowed (${MAX_BASE_DECIMALS})`);
    }
    
    console.log(`✓ Base token decimals: ${decimals} (max: ${MAX_BASE_DECIMALS})`);
  } catch (error) {
    errors.push(`Failed to validate base token decimals: ${error.message}`);
  }
}

function validateStoreFrontPriceFactor(
  config: NetworkConfiguration,
  errors: string[]
): void {
  const storeFrontPriceFactor = config.storeFrontPriceFactor * FACTOR_SCALE;
  
  if (storeFrontPriceFactor > FACTOR_SCALE) {
    errors.push(`Store front price factor (${storeFrontPriceFactor}) exceeds maximum allowed (${FACTOR_SCALE})`);
  }
  
  console.log(`✓ Store front price factor: ${storeFrontPriceFactor} (max: ${FACTOR_SCALE})`);
}

function validateNumberOfAssets(
  config: NetworkConfiguration,
  errors: string[]
): void {
  const numAssets = Object.keys(config.assets).length;
  
  if (numAssets > MAX_ASSETS) {
    errors.push(`Number of assets (${numAssets}) exceeds maximum allowed (${MAX_ASSETS})`);
  }
  
  console.log(`✓ Number of assets: ${numAssets} (max: ${MAX_ASSETS})`);
}

function validateBaseMinForRewards(
  config: NetworkConfiguration,
  errors: string[]
): void {
  const baseMinForRewards = parseScientificNotation(config.tracking.baseMinForRewards);
  
  if (baseMinForRewards === 0n) {
    errors.push(`Base min for rewards cannot be zero`);
  }
  
  console.log(`✓ Base min for rewards: ${baseMinForRewards}`);
}

async function validateBaseTokenPriceFeedDecimals(
  config: NetworkConfiguration,
  contracts: ContractMap,
  errors: string[],
  hre: HardhatRuntimeEnvironment
): Promise<void> {
  try {
    const priceFeedAddress = getContractAddress(`${config.baseToken}:priceFeed`, contracts, config.baseTokenPriceFeed);
    const priceFeed = await hre.ethers.getContractAt('IPriceFeed', priceFeedAddress);
    const decimals = await priceFeed.decimals();
    
    if (decimals !== PRICE_FEED_DECIMALS) {
      errors.push(`Base token price feed decimals (${decimals}) must be ${PRICE_FEED_DECIMALS}`);
      console.log(`❌ Base token price feed decimals: ${decimals} (required: ${PRICE_FEED_DECIMALS})`);
    } else {
      console.log(`✓ Base token price feed decimals: ${decimals} (required: ${PRICE_FEED_DECIMALS})`);
    }
  } catch (error) {
    errors.push(`Failed to validate base token price feed decimals: ${error.message}`);
  }
}

async function validateBaseScale(
  config: NetworkConfiguration,
  contracts: ContractMap,
  errors: string[],
  hre: HardhatRuntimeEnvironment
): Promise<void> {
  try {
    const baseTokenAddress = getContractAddress(config.baseToken, contracts, config.baseTokenAddress);
    const baseToken = await hre.ethers.getContractAt('IERC20NonStandard', baseTokenAddress);
    const decimals = await baseToken.decimals();
    const baseScale = 10n ** BigInt(decimals);
    
    if (baseScale < BASE_ACCRUAL_SCALE) {
      errors.push(`Base scale (${baseScale}) must be >= BASE_ACCRUAL_SCALE (${BASE_ACCRUAL_SCALE})`);
    }
    
    console.log(`✓ Base scale: ${baseScale} (min: ${BASE_ACCRUAL_SCALE})`);
  } catch (error) {
    errors.push(`Failed to validate base scale: ${error.message}`);
  }
}

async function validateAssetConfigurations(
  config: NetworkConfiguration,
  contracts: ContractMap,
  errors: string[],
  hre: HardhatRuntimeEnvironment
): Promise<void> {
  for (const [assetName, assetConfig] of Object.entries(config.assets)) {
    console.log(`\nValidating asset: ${assetName}`);
    
    try {
      // Validate asset decimals
      await validateAssetDecimals(assetName, assetConfig, contracts, errors, hre);
      
      // Validate price feed decimals
      await validateAssetPriceFeedDecimals(assetName, assetConfig, contracts, errors, hre);
      
      // Validate collateral factors
      validateCollateralFactors(assetName, assetConfig, errors);
      
    } catch (error) {
      errors.push(`Failed to validate asset ${assetName}: ${error.message}`);
    }
  }
}

async function validateAssetDecimals(
  assetName: string,
  assetConfig: any,
  contracts: ContractMap,
  errors: string[],
  hre: HardhatRuntimeEnvironment
): Promise<void> {
  try {
    const assetAddress = getContractAddress(assetName, contracts, assetConfig.address);
    const asset = await hre.ethers.getContractAt('IERC20NonStandard', assetAddress);
    const actualDecimals = await asset.decimals();
    const configDecimals = assetConfig.decimals;
    
    if (actualDecimals !== configDecimals) {
      errors.push(`Asset ${assetName} decimals mismatch: actual=${actualDecimals}, config=${configDecimals}`);
    }
    
    console.log(`  ✓ Asset decimals: ${actualDecimals} (config: ${configDecimals})`);
  } catch (error) {
    errors.push(`Failed to validate asset ${assetName} decimals: ${error.message}`);
  }
}

async function validateAssetPriceFeedDecimals(
  assetName: string,
  assetConfig: any,
  contracts: ContractMap,
  errors: string[],
  hre: HardhatRuntimeEnvironment
): Promise<void> {
  try {
    const priceFeedAddress = getContractAddress(`${assetName}:priceFeed`, contracts, assetConfig.priceFeed);
    const priceFeed = await hre.ethers.getContractAt('IPriceFeed', priceFeedAddress);
    const decimals = await priceFeed.decimals();
    
    if (decimals !== PRICE_FEED_DECIMALS) {
      errors.push(`Asset ${assetName} price feed decimals (${decimals}) must be ${PRICE_FEED_DECIMALS}`);
      console.log(`  ❌ Price feed decimals: ${decimals} (required: ${PRICE_FEED_DECIMALS})`);
    } else {
      console.log(`  ✓ Price feed decimals: ${decimals} (required: ${PRICE_FEED_DECIMALS})`);
    }
  } catch (error) {
    errors.push(`Failed to validate asset ${assetName} price feed decimals: ${error.message}`);
  }
}

function validateCollateralFactors(
  assetName: string,
  assetConfig: any,
  errors: string[]
): void {
  const borrowCF = assetConfig.borrowCF * FACTOR_SCALE;
  const liquidateCF = assetConfig.liquidateCF * FACTOR_SCALE;
  const liquidationFactor = assetConfig.liquidationFactor * FACTOR_SCALE;
  
  // Check borrowCF < liquidateCF
  if (borrowCF >= liquidateCF) {
    errors.push(`Asset ${assetName}: borrowCollateralFactor (${borrowCF}) must be < liquidateCollateralFactor (${liquidateCF})`);
  }
  
  // Check liquidateCF <= MAX_COLLATERAL_FACTOR
  if (liquidateCF > MAX_COLLATERAL_FACTOR) {
    errors.push(`Asset ${assetName}: liquidateCollateralFactor (${liquidateCF}) exceeds maximum allowed (${MAX_COLLATERAL_FACTOR})`);
  }
  
  console.log(`  ✓ Borrow CF: ${borrowCF}`);
  console.log(`  ✓ Liquidate CF: ${liquidateCF}`);
  console.log(`  ✓ Liquidation Factor: ${liquidationFactor}`);
}

// Helper functions
function getContractAddress(contractName: string, contracts: ContractMap, fallbackAddress?: string): string {
  let contract = contracts.get(contractName);
  if (!contract) {
    if (fallbackAddress) return fallbackAddress;
    throw new Error(
      `Cannot find contract \`${contractName}\` in contract map with keys \`${JSON.stringify(
        [...contracts.keys()]
      )}\``
    );
  }
  return contract.address;
}

function parseScientificNotation(x: string): bigint {
  if (typeof x !== 'string') {
    throw new Error(`expected argument to be string, got ${x}`);
  }
  const sanitizedInput = x.replace(/_/g, '');
  if (!sanitizedInput.match(/^[0-9]+([.][0-9]+)?e[0-9]+$/)) {
    throw new Error(`expected string in scientific notation form, got ${x}`);
  }

  const nums = sanitizedInput.split('e');
  const coefficient = Number(nums[0]);
  const exponent = Number(nums[1]);
  
  if (!Number.isInteger(coefficient)) {
    return BigInt(Math.floor(Number(sanitizedInput)));
  } else {
    return BigInt(coefficient) * (10n ** BigInt(exponent));
  }
}
