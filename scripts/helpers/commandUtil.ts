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