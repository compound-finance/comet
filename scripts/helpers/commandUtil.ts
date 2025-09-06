import { execSync } from 'child_process';
import { log } from './ioUtil';

/**
 * Runs a command with logging and error handling
 * @param command - The command to execute
 * @param description - Description of what the command does (for logging)
 */
export async function runCommand(
  command: string, 
  description: string
): Promise<void> {
  log(`\n🔄 ${description}...`, 'info');
  try {
    execSync(command, { 
      stdio: 'inherit',
      encoding: 'utf8'
    });
    log(`✅ ${description} completed successfully`, 'success');
  } catch (error) {
    log(`❌ ${description} failed: ${error}`, 'error');
    throw error;
  }
}

/**
 * Runs a command and returns the output
 * @param command - The command to execute
 * @param description - Description of what the command does (for logging)
 * @returns Promise<string> - The command output
 */
export async function runCommandWithOutput(
  command: string, 
  description: string
): Promise<string> {
  log(`\n🔄 ${description}...`, 'info');
  try {
    const output = execSync(command, { 
      stdio: 'pipe',
      encoding: 'utf8'
    });
    log(`✅ ${description} completed successfully`, 'success');
    return output;
  } catch (error) {
    log(`❌ ${description} failed: ${error}`, 'error');
    throw error;
  }
}