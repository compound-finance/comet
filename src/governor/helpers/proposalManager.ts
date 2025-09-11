import * as fs from 'fs';
import * as path from 'path';
import { BigNumberish } from 'ethers';
import { DeploymentManager } from '../../../plugins/deployment_manager';
import { extractProposalIdFromLogs } from '../../deploy/helpers';
import { 
  ProposalData, 
  ProposalStack, 
  ProposalStackAction, 
  ProposalAction,
  ProposalExecutionResult 
} from '../types/proposalTypes';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

/**
 * Proposal Manager for handling proposal files and execution
 */
export class ProposalManager {
  private deploymentManager: DeploymentManager;
  private proposalStackPath: string;

  constructor(deploymentManager: DeploymentManager, network: string, deployment?: string) {
    this.deploymentManager = deploymentManager;
    this.proposalStackPath = path.join(
      process.cwd(),
      'deployments',
      network,
      deployment || '',
      'proposalStack.json'
    );
  }

  /**
   * Add an action to the proposal stack
   * @param action - The proposal action to add
   * @param description - Optional description for this specific action
   */
  async addAction(action: ProposalAction, description?: string): Promise<void> {
    const stack = await this.loadProposalStack();
    const actionId = this.generateActionId();
    
    let stackAction: ProposalStackAction;
    
    let calldata: string;
    let target: string;
    if ('contract' in action) {
      // Contract action
      calldata = action.contract.interface.encodeFunctionData(action.signature, action.args);
      target = action.contract.address;
    } else {
      target = action.target;
      calldata = action.calldata;
    }
    
    stackAction = {
      id: actionId,
      target,
      value: action.value,
      calldata,
      description
    };
    
    stack.actions.push(stackAction);
    await this.saveProposalStack(stack);
    
    const trace = this.deploymentManager.tracer();
    trace(`Added action to proposal stack: ${stackAction.target}`);
  }

  /**
   * Add multiple actions to the proposal stack
   * @param actions - Array of proposal actions to add
   * @param descriptions - Optional descriptions for each action
   */
  async addActions(actions: ProposalAction[], descriptions?: string[]): Promise<void> {
    for (let i = 0; i < actions.length; i++) {
      const description = descriptions?.[i];
      await this.addAction(actions[i], description);
    }
  }

  /**
   * Set the overall proposal description
   * @param description - The proposal description
   */
  async setDescription(description: string): Promise<void> {
    const stack = await this.loadProposalStack();
    stack.description = description;
    await this.saveProposalStack(stack);
  }

  /**
   * Add metadata to the proposal
   * @param key - Metadata key
   * @param value - Metadata value
   */
  async addMetadata(key: string, value: any): Promise<void> {
    const stack = await this.loadProposalStack();
    if (!stack.metadata) {
      stack.metadata = {};
    }
    stack.metadata[key] = value;
    await this.saveProposalStack(stack);
  }

  /**
   * Clear the proposal stack (reset to empty)
   */
  async clearProposalStack(): Promise<void> {
    const emptyStack: ProposalStack = {
      actions: [],
      description: '',
      metadata: {}
    };
    await this.saveProposalStack(emptyStack);
    
    const trace = this.deploymentManager.tracer();
    trace('Cleared proposal stack');
  }

  /**
   * Load the current proposal stack from file
   */
  async loadProposalStack(): Promise<ProposalStack> {
    try {
      if (fs.existsSync(this.proposalStackPath)) {
        const content = fs.readFileSync(this.proposalStackPath, 'utf8');
        return JSON.parse(content);
      }
    } catch (error) {
      const trace = this.deploymentManager.tracer();
      trace(`Warning: Could not load proposal stack: ${error}`);
    }
    
    return {
      actions: [],
      description: '',
      metadata: {}
    };
  }

  /**
   * Save the proposal stack to file
   */
  private async saveProposalStack(stack: ProposalStack): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(this.proposalStackPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Serialize BigInt values before saving
    const serializedStack = serializeBigInt(stack);
    fs.writeFileSync(this.proposalStackPath, JSON.stringify(serializedStack, null, 2));
  }

  /**
   * Convert proposal stack to proposal data for execution
   */
  async toProposalData(): Promise<ProposalData> {
    const stack = await this.loadProposalStack();
    
    if (stack.actions.length === 0) {
      throw new Error('No actions in proposal stack');
    }

    const targets: string[] = [];
    const values: BigNumberish[] = [];
    const calldatas: string[] = [];

    for (const action of stack.actions) {
      targets.push(action.target);
      values.push(action.value || 0);
      calldatas.push(action.calldata);
    }

    return {
      targets,
      values,
      calldatas,
      description: stack.description || 'Proposal from proposal stack',
      metadata: stack.metadata
    };
  }

  /**
   * Execute the proposal by submitting it to the governor
   */
  async executeProposal(adminSigner?: SignerWithAddress): Promise<ProposalExecutionResult> {
    const proposalData = await this.toProposalData();
    const governor = await this.deploymentManager.getContractOrThrow('governor');
    const admin = adminSigner ?? await this.deploymentManager.getSigner();
    
    const trace = this.deploymentManager.tracer();
    trace(`Executing proposal with ${proposalData.targets.length} actions`);
    trace(`Proposal description: ${proposalData.description}`);
    
    const tx = await governor.connect(admin).propose(
      proposalData.targets,
      proposalData.values,
      proposalData.calldatas,
      proposalData.description
    );
    
    const receipt = await tx.wait();
    trace(`Proposal submitted! Transaction hash: ${receipt.transactionHash}`);
    
    // Extract proposal ID from logs
    const proposalId = extractProposalIdFromLogs(governor, receipt);

    await this.clearProposalStack();
    
    return {
      proposalId: proposalId?.toString() || 'unknown',
      transactionHash: receipt.transactionHash,
      targets: proposalData.targets,
      values: proposalData.values,
      calldatas: proposalData.calldatas,
      description: proposalData.description
    };
  }

  /**
   * Get the proposal stack file path
   */
  getProposalStackPath(): string {
    return this.proposalStackPath;
  }

  /**
   * Check if proposal stack has actions
   */
  async hasActions(): Promise<boolean> {
    const stack = await this.loadProposalStack();
    return stack.actions.length > 0;
  }

  /**
   * Get the number of actions in the proposal stack
   */
  async getActionCount(): Promise<number> {
    const stack = await this.loadProposalStack();
    return stack.actions.length;
  }

  /**
   * Generate a unique action ID
   */
  private generateActionId(): string {
    return `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

}

/**
 * Create a new ProposalManager instance
 */
export function createProposalManager(
  deploymentManager: DeploymentManager, 
  network: string,
  deployment?: string
): ProposalManager {
  return new ProposalManager(deploymentManager, network, deployment);
}

/**
 * Simple function to convert BigInt values to strings for JSON serialization
 */
function serializeBigInt(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === 'bigint') {
    return obj.toString();
  }
  
  if (Array.isArray(obj)) {
    return obj.map(serializeBigInt);
  }
  
  if (typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeBigInt(value);
    }
    return result;
  }
  
  return obj;
}
