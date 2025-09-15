import { ethers } from 'ethers';
import 'dotenv/config';

export interface GovConfig {
  governorSigners: string[];
  multisigThreshold: number;
  timelockDelay: number;
  gracePeriod: number;
  minimumDelay: number;
  maximumDelay: number;
}

/**
 * Validates governance environment variables and returns a GovConfig object
 * @returns GovConfig - The validated governance configuration
 * @throws Error if any environment variable is invalid or missing
 */
export function validateGovEnvironmentVariables(): GovConfig {
  const governorSigners = process.env.GOV_SIGNERS?.split(',');
  if (!governorSigners) {
    throw new Error('GOV_SIGNERS should be set in the environment file');
  }
  if (governorSigners.some(signer => !ethers.utils.isAddress(signer))) {
    throw new Error('GOV_SIGNERS should be a comma separated list of valid addresses');
  }
  if (!process.env.MULTISIG_THRESHOLD) {
    throw new Error('MULTISIG_THRESHOLD should be set in the environment file');
  }
  const multisigThreshold = parseInt(process.env.MULTISIG_THRESHOLD);
  if (isNaN(multisigThreshold) || multisigThreshold <= 0) {
    throw new Error('MULTISIG_THRESHOLD should be a positive integer');
  }
  
  if (!process.env.TIMELOCK_DELAY) {
    throw new Error('TIMELOCK_DELAY should be set in the environment file');
  }
  const timelockDelay = parseInt(process.env.TIMELOCK_DELAY);
  if (isNaN(timelockDelay) || timelockDelay < 0) {
    throw new Error('TIMELOCK_DELAY should be a non-negative integer');
  }
  
  if (!process.env.GRACE_PERIOD) {
    throw new Error('GRACE_PERIOD should be set in the environment file');
  }
  const gracePeriod = parseInt(process.env.GRACE_PERIOD);
  if (isNaN(gracePeriod) || gracePeriod <= 0) {
    throw new Error('GRACE_PERIOD should be a positive integer');
  }
  
  if (!process.env.MINIMUM_DELAY) {
    throw new Error('MINIMUM_DELAY should be set in the environment file');
  }
  const minimumDelay = parseInt(process.env.MINIMUM_DELAY);
  if (isNaN(minimumDelay) || minimumDelay < 0) {
    throw new Error('MINIMUM_DELAY should be a non-negative integer');
  }
  
  if (!process.env.MAXIMUM_DELAY) {
    throw new Error('MAXIMUM_DELAY should be set in the environment file');
  }
  const maximumDelay = parseInt(process.env.MAXIMUM_DELAY);
  if (isNaN(maximumDelay) || maximumDelay <= 0) {
    throw new Error('MAXIMUM_DELAY should be a positive integer');
  }
  
  // Validate that timelock delay is within bounds
  if (timelockDelay < minimumDelay) {
    throw new Error('TIMELOCK_DELAY must be greater than or equal to MINIMUM_DELAY');
  }
  if (timelockDelay > maximumDelay) {
    throw new Error('TIMELOCK_DELAY must be less than or equal to MAXIMUM_DELAY');
  }
  
  return { governorSigners, multisigThreshold, timelockDelay, gracePeriod, minimumDelay, maximumDelay };
}
