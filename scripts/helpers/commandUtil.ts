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
 * @returns Promise<string> - The command output
 */
export async function deployInfrastructure(network: string): Promise<string> {
  const command = `yarn hardhat deploy_infrastructure --network ${network} --bdag`;
  return await runCommand(command, 'Deploying infrastructure');
}

/**
 * Deploy a single market using batch deploy mode
 * @param network - The network to deploy to
 * @param deployment - The deployment name (e.g., 'dai', 'usdc')
 * @returns Promise<string> - The command output
 */
export async function deployMarket(network: string, deployment: string): Promise<string> {
  const command = `yarn hardhat deploy --network ${network} --deployment ${deployment} --bdag --batchdeploy`;
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
 * @returns Promise<string> - The command output
 */
export async function runDeploymentVerification(network: string, deployment: string): Promise<string> {
  const command = `MARKET=${deployment} yarn hardhat test test/deployment-verification-test.ts --network ${network}`;
  return await runCommand(command, `Running deployment verification test for ${deployment}`, true);
}

/**
 * Propose an upgrade for a specific market
 * @param network - The network to propose the upgrade on
 * @param deployment - The deployment name
 * @param implementationAddress - The new implementation address
 * @returns Promise<string> - The command output
 */
export async function proposeUpgrade(network: string, deployment: string, implementationAddress: string): Promise<string> {
  const command = `yarn hardhat governor:propose-upgrade --network ${network} --deployment ${deployment} --implementation ${implementationAddress} --batchdeploy`;
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