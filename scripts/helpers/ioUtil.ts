import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

export type LogType = 'info' | 'success' | 'warning' | 'error';

/**
 * Logs a message with color coding
 * @param message - The message to log
 * @param type - The type of log message (determines color)
 */
export function log(message: string, type: LogType = 'info'): void {
  const colors = {
    info: '\x1b[36m',    // Cyan
    success: '\x1b[32m', // Green
    warning: '\x1b[33m', // Yellow
    error: '\x1b[31m'    // Red
  };
  const reset = '\x1b[0m';
  console.log(`${colors[type]}${message}${reset}`);
}

/**
 * Asks a question and returns the user's input
 * @param prompt - The question prompt
 * @returns Promise<string> - The user's input
 */
export async function question(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    return await new Promise<string>((resolve, _reject) => {
      rl.question(prompt, (answer) => {
        resolve(answer.trim());
      });
    });
  } catch (error) {
    log(`\n⚠️  Failed to ask question: ${error}`, 'error');
    throw error;
  } finally {
    rl.close();
  }
}

/**
 * Asks a yes/no question and returns a boolean
 * @param prompt - The question prompt
 * @returns Promise<boolean> - True if user answered yes, false otherwise
 */
export async function confirm(prompt: string): Promise<boolean> {
  for await (const _ of Array(10)) {
    const answer = await question(`${prompt} (Y/n): `);
    const lowerAnswer = answer.toLowerCase().trim();
    
    if (lowerAnswer === '' || lowerAnswer === 'y' || lowerAnswer === 'yes') {
      return true;
    } else if (lowerAnswer === 'n' || lowerAnswer === 'no') {
      return false;
    } else {
      log(`Please enter 'y' for yes or 'n' for no.`, 'warning');
    }
  }
  throw new Error('User did not answer yes or no after 10 attempts');
}