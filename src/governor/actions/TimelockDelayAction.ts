import { DeploymentManager } from '../../../plugins/deployment_manager';
import { Proposal } from '../models';
import { utils } from 'ethers';

/**
 * Action for creating timelock delay change proposals
 */
export class TimelockDelayAction {
  constructor(
    private deploymentManager: DeploymentManager,
    private newDelay: number
  ) {}

  /**
   * Build the proposal data for timelock delay change
   */
  async build(): Promise<Proposal> {
    if (this.newDelay <= 0) {
      throw new Error('Timelock delay must be greater than 0');
    }

    const timelock = await this.deploymentManager.getContractOrThrow('timelock');
    const currentDelay = await timelock.delay();
    const delayBN = utils.parseUnits(this.newDelay.toString(), 0);

    const proposal: Proposal = {
      targets: [timelock.address],
      values: [0],
      calldatas: [
        timelock.interface.encodeFunctionData('setDelay', [delayBN])
      ],
      description: `Change timelock delay from ${currentDelay} seconds to ${this.newDelay} seconds`
    };

    return proposal;
  }

  /**
   * Get current timelock delay for comparison
   */
  async getCurrentDelay(): Promise<number> {
    const timelock = await this.deploymentManager.getContractOrThrow('timelock');
    const delay = await timelock.delay();
    return delay.toNumber();
  }

  /**
   * Get delay change summary
   */
  async getDelaySummary(): Promise<{ currentDelay: number, newDelay: number, delayBN: string }> {
    const currentDelay = await this.getCurrentDelay();
    const delayBN = utils.parseUnits(this.newDelay.toString(), 0);
    
    return {
      currentDelay,
      newDelay: this.newDelay,
      delayBN: delayBN.toString()
    };
  }
}
