import { execSync } from 'child_process';
import { log } from './ioUtil';

/**
 * Runs a command and returns the output
 * @param command - The command to execute
 * @param description - Description of what the command does (for logging)
 * @returns Promise<string> - The command output
 */
export async function runCommand(
  command: string, 
  description: string,
  printOutput: boolean = false
): Promise<string> {
  log(`\n🔄 ${description}...`, 'info');
  try {
    const output = execSync(command, { 
      stdio: 'pipe',
      encoding: 'utf8'
    });
    if (printOutput) {
      log(`Output: ${output}`, 'info');
    }
    log(`✅ ${description} completed successfully`, 'success');
    return output;
  } catch (error) {
    log(`❌ ${description} failed: ${error}`, 'error');
    throw error;
  }
}

/**
 * Extracts proposal ID from command output
 * @param output - The command output to search
 * @returns string - The extracted proposal ID
 * @throws Error if proposal ID cannot be found
 */
export function extractProposalId(output: string): string {
  const proposalIdMatch = output.match(/Proposal ID: (\d+)/);
  if (proposalIdMatch) {
    return proposalIdMatch[1];
  }
  
  throw new Error('Could not extract proposal ID from output');
}

/**
 * Extracts implementation address from governance flow response logs
 * @param output - The governance flow response output to search
 * @returns string[] - The extracted implementation addresses
 * @throws Error if implementation address cannot be found
 */
export function extractImplementationAddresses(output: string): string[] {
  // Look for "newComet": "0x..." pattern in the logs with global flag
  const implAddressRegex = /"newComet"\s*:\s*"(0x[a-fA-F0-9]{40})"/g;
  const addresses: string[] = [];
  let match;
  
  while ((match = implAddressRegex.exec(output)) !== null) {
    addresses.push(match[1]);
  }
  
  if (addresses.length > 0) {
    return addresses;
  }
  
  throw new Error('Could not extract implementation addresses from governance flow response');
}

/**
 * Build the project using yarn build
 * @returns Promise<string> - The command output
 */
export async function buildProject(): Promise<string> {
  return await runCommand('yarn build', 'Building project');
}

/**
 * Clear the proposal stack
 * @param network - The network to clear the stack for
 * @returns Promise<string> - The command output
 */
export async function clearProposalStack(network: string): Promise<string> {
  const command = `yarn hardhat governor:clear-stack --network ${network}`;
  return await runCommand(command, 'Clearing proposal stack');
}

/**
 * Deploy infrastructure contracts
 * @param network - The network to deploy to
 * @param bdag - Whether to use BDAG custom governor (adds --bdag flag)
 * @returns Promise<string> - The command output
 */
export async function deployInfrastructure(network: string, bdag: boolean = true, batchdeploy: boolean = false): Promise<string> {
  let command = `yarn hardhat deploy_infrastructure --network ${network}`;
  if (bdag) {
    command += ' --bdag';
  }
  if (batchdeploy) {
    command += ' --batchdeploy';
  }
  return await runCommand(command, 'Deploying infrastructure');
}

/**
 * Deploy a single market
 * @param network - The network to deploy to
 * @param deployment - The deployment name (e.g., 'dai', 'usdc')
 * @param bdag - Whether to use BDAG custom governor (adds --bdag flag)
 * @param batchDeploy - Whether to use batch deploy mode (adds --batchdeploy flag)
 * @returns Promise<string> - The command output
 */
export async function deployMarket(network: string, deployment: string, bdag: boolean = true, batchDeploy: boolean = false): Promise<string> {
  let command = `yarn hardhat deploy --network ${network} --deployment ${deployment}`;
  if (bdag) {
    command += ' --bdag';
  }
  if (batchDeploy) {
    command += ' --batchdeploy';
  }
  return await runCommand(command, `Deploying market: ${deployment}`);
}

/**
 * Execute a batch proposal from the proposal stack
 * @param network - The network to execute the proposal on
 * @returns Promise<string> - The command output
 */
export async function executeBatchProposal(network: string): Promise<string> {
  const command = `yarn hardhat governor:execute-batch-proposal --network ${network}`;
  return await runCommand(command, 'Executing batch proposal');
}

/**
 * Run deployment verification test for a specific market
 * @param network - The network to run the test on
 * @param deployment - The deployment name to verify
 * @param printOutput - Whether to print the command output
 * @returns Promise<string> - The command output
 */
export async function runDeploymentVerification(network: string, deployment: string, printOutput: boolean = true): Promise<string> {
  const command = `MARKET=${deployment} yarn hardhat test test/deployment-verification-test.ts --network ${network}`;
  return await runCommand(command, `Running deployment verification test for ${deployment}`, printOutput);
}

/**
 * Propose an upgrade for a specific market
 * @param network - The network to propose the upgrade on
 * @param deployment - The deployment name
 * @param implementationAddress - The new implementation address
 * @param batchDeploy - Whether to use batch deploy mode (adds --batchdeploy flag)
 * @returns Promise<string> - The command output
 */
export async function proposeUpgrade(network: string, deployment: string, implementationAddress: string, batchDeploy: boolean = false): Promise<string> {
  let command = `yarn hardhat governor:propose-upgrade --network ${network} --deployment ${deployment} --implementation ${implementationAddress}`;
  if (batchDeploy) {
    command += ' --batchdeploy';
  }
  return await runCommand(command, `Proposing upgrade for ${deployment}`);
}

/**
 * Refresh roots for a specific market using spider
 * @param network - The network to refresh roots on
 * @param deployment - The deployment name to refresh
 * @returns Promise<string> - The command output
 */
export async function runSpiderForMarket(network: string, deployment: string): Promise<string> {
  const command = `yarn hardhat spider --network ${network} --deployment ${deployment}`;
  return await runCommand(command, `Refreshing roots for ${deployment}`);
}

/**
 * Propose funding CometRewards contract
 * @param network - The network to propose the funding on
 * @param amount - The amount of COMP tokens to transfer (in wei)
 * @returns Promise<string> - The command output
 */
export async function proposeFundRewards(network: string, amount: string): Promise<string> {
  const command = `yarn hardhat governor:propose-fund-comet-rewards --network ${network} --amount ${amount}`;
  return await runCommand(command, `Proposing CometRewards funding with ${amount} COMP tokens for all markets`);
}

/**
 * Propose a governance update
 * @param network - The network to propose the update on
 * @param deployment - The deployment name
 * @param admins - Array of admin addresses
 * @param threshold - Number of required approvals
 * @param timelockDelay - Optional timelock delay in seconds
 * @returns Promise<string> - The command output
 */
export async function proposeGovernanceUpdate(
  network: string, 
  deployment: string, 
  admins?: string[], 
  threshold?: number, 
  timelockDelay?: number
): Promise<string> {
  let command = `yarn hardhat governor:propose-governance-update --network ${network} --deployment ${deployment}`;
  
  if (admins && threshold) {
    const adminsParam = admins.join(',');
    command += ` --admins "${adminsParam}" --threshold ${threshold}`;
  }
  
  if (timelockDelay) {
    command += ` --timelock-delay ${timelockDelay}`;
  }
  
  return await runCommand(command, 'Proposing governance update');
}