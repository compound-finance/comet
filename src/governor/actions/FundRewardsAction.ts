import { DeploymentManager } from '../../../plugins/deployment_manager';
import { Proposal } from '../models';

/**
 * Action for creating CometRewards funding proposals
 */
export class FundRewardsAction {
  constructor(
    private deploymentManager: DeploymentManager,
    private amount: string
  ) {}

  /**
   * Build the proposal data for funding CometRewards
   */
  async build(): Promise<Proposal> {
    if (!this.amount) {
      throw new Error('Amount is required');
    }

    // Parse amount (expecting string like "1000000000000000000000" for 1000 COMP with 18 decimals)
    const transferAmount = BigInt(this.amount);
    
    if (transferAmount <= 0) {
      throw new Error('Amount must be greater than 0');
    }

    const COMP = await this.deploymentManager.getContractOrThrow('COMP');
    const rewards = await this.deploymentManager.getContractOrThrow('rewards');

    const proposal: Proposal = {
      targets: [COMP.address],
      values: [0],
      calldatas: [
        COMP.interface.encodeFunctionData('transfer', [
          rewards.address, 
          transferAmount
        ])
      ],
      description: `Fund CometRewards contract with ${transferAmount} COMP tokens`
    };

    return proposal;
  }

  /**
   * Get funding summary
   */
  async getFundingSummary(): Promise<{ 
    amount: string; 
    from: string; 
    to: string; 
    compAddress: string; 
    rewardsAddress: string; 
  }> {
    const COMP = await this.deploymentManager.getContractOrThrow('COMP');
    const rewards = await this.deploymentManager.getContractOrThrow('rewards');
    const timelock = await this.deploymentManager.getContractOrThrow('timelock');

    return {
      amount: this.amount,
      from: timelock.address,
      to: rewards.address,
      compAddress: COMP.address,
      rewardsAddress: rewards.address
    };
  }

  /**
   * Get current balances for context
   */
  async getCurrentBalances(): Promise<{ 
    timelockBalance: string; 
    rewardsBalance: string; 
  }> {
    const COMP = await this.deploymentManager.getContractOrThrow('COMP');
    const rewards = await this.deploymentManager.getContractOrThrow('rewards');
    const timelock = await this.deploymentManager.getContractOrThrow('timelock');

    const timelockBalance = await COMP.balanceOf(timelock.address);
    const rewardsBalance = await COMP.balanceOf(rewards.address);

    return {
      timelockBalance: timelockBalance.toString(),
      rewardsBalance: rewardsBalance.toString()
    };
  }
}
