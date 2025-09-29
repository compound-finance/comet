/**
 * Governance configuration data
 */
export interface GovernanceConfig {
  admins: string[];
  threshold: number;
}

/**
 * Timelock configuration
 */
export interface TimelockConfig {
  delay: number; // in seconds
}

/**
 * Combined governance and timelock update
 */
export interface GovernanceUpdate {
  admins?: string[];
  threshold?: number;
  timelockDelay?: number;
}

/**
 * Validation result for governance configuration
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Governance update options
 */
export interface GovernanceUpdateOptions {
  updateGovernance: boolean;
  updateTimelock: boolean;
  admins?: string[];
  threshold?: number;
  timelockDelay?: number;
}
