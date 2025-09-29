import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { ProposalService } from '../../services/ProposalService';
import { FundRewardsAction } from '../../actions/FundRewardsAction';

/**
 * Task for proposing CometRewards funding
 */
export default async function proposeFundCometRewardsTask(
  hre: HardhatRuntimeEnvironment, 
  amount: string
): Promise<any> {
  if (!amount) {
    throw new Error('Amount is required (in wei, e.g., "1000000000000000000000" for 1000 COMP)');
  }
  
  const deploymentManager = (hre as any).deploymentManager;
  
  if (!deploymentManager) {
    throw new Error('DeploymentManager not found. Make sure to call createDeploymentManager first.');
  }
  
  console.log(`Proposing to fund CometRewards with ${amount} COMP tokens...`);
  
  try {
    // Create the fund rewards action
    const action = new FundRewardsAction(deploymentManager, amount);
    const proposal = await action.build();
    const fundingSummary = await action.getFundingSummary();
    const balances = await action.getCurrentBalances();

    console.log(`   Amount: ${fundingSummary.amount} COMP tokens`);
    console.log(`   From: ${fundingSummary.from} (timelock)`);
    console.log(`   To: ${fundingSummary.to} (CometRewards)`);
    console.log(`   Current timelock COMP balance: ${balances.timelockBalance}`);
    console.log(`   Current rewards COMP balance: ${balances.rewardsBalance}`);

    // Create the service and submit the proposal
    const service = new ProposalService(deploymentManager);
    const result = await service.createProposal(proposal);
    
    return {
      ...result,
      amount: fundingSummary.amount,
      from: fundingSummary.from,
      to: fundingSummary.to,
      compAddress: fundingSummary.compAddress,
      rewardsAddress: fundingSummary.rewardsAddress,
      timelockBalance: balances.timelockBalance,
      rewardsBalance: balances.rewardsBalance
    };
  } catch (error) {
    console.error(`❌ Failed to propose CometRewards funding:`, error);
    throw error;
  }
}
