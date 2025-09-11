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

/**
 * Proposal Manager for handling proposal files and execution
 */
export class ProposalManager {
  private deploymentManager: DeploymentManager;
  private network: string;
  private deployment: string;
  private proposalStackPath: string;

  constructor(deploymentManager: DeploymentManager, network: string, deployment: string) {
    this.deploymentManager = deploymentManager;
    this.network = network;
    this.deployment = deployment;
    this.proposalStackPath = path.join(
      process.cwd(),
      'deployments',
      network,
      deployment,
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
    
    if ('contract' in action) {
      // Contract action
      stackAction = {
        id: actionId,
        type: 'contract',
        target: action.contract.address,
        value: action.value,
        signature: action.signature,
        args: action.args,
        contractAddress: action.contract.address,
        description
      };
    } else {
      // Target action
      stackAction = {
        id: actionId,
        type: 'target',
        target: action.target,
        value: action.value,
        signature: action.signature,
        calldata: action.calldata,
        description
      };
    }
    
    stack.actions.push(stackAction);
    await this.saveProposalStack(stack);
    
    const trace = this.deploymentManager.tracer();
    trace(`Added action to proposal stack: ${stackAction.signature} on ${stackAction.target}`);
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
    
    fs.writeFileSync(this.proposalStackPath, JSON.stringify(stack, null, 2));
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
      
      if (action.type === 'contract' && action.args) {
        // For contract actions, we need to encode the function call
        const contract = await this.deploymentManager.contract(action.contractAddress!);
        if (!contract) {
          throw new Error(`Contract not found: ${action.contractAddress}`);
        }
        const calldata = contract.interface.encodeFunctionData(action.signature, action.args);
        calldatas.push(calldata);
      } else if (action.type === 'target' && action.calldata) {
        // For target actions, use the pre-encoded calldata
        calldatas.push(action.calldata);
      } else {
        throw new Error(`Invalid action data for action ${action.id}`);
      }
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
  async executeProposal(): Promise<ProposalExecutionResult> {
    const proposalData = await this.toProposalData();
    const governor = await this.deploymentManager.getContractOrThrow('governor');
    const admin = await this.deploymentManager.getSigner();
    
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
  deployment: string
): ProposalManager {
  return new ProposalManager(deploymentManager, network, deployment);
}
