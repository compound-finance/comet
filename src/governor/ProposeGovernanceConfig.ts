import { HardhatRuntimeEnvironment } from 'hardhat/types';

export default async function proposeGovernanceConfigTask(
  hre: HardhatRuntimeEnvironment,
  newAdmins: string[],
  newThreshold: number
): Promise<any> {
  const deploymentManager = (hre as any).deploymentManager;
  
  if (!deploymentManager) {
    throw new Error('DeploymentManager not found. Make sure to call createDeploymentManager first.');
  }

  // Get the governor contract
  const governor = await deploymentManager.contract('governor');
  
  if (!governor) {
    throw new Error('Governor contract not found in deployment');
  }

  console.log('📋 Creating governance configuration proposal...');
  console.log(`   Current admins: ${newAdmins.length} addresses`);
  console.log(`   New threshold: ${newThreshold}`);

  // Create the proposal data
  const targets = [governor.address];
  const values = [0];
  const calldatas = [
    governor.interface.encodeFunctionData('setGovernanceConfig', [newAdmins, newThreshold])
  ];
  const description = `Update governance configuration: Set ${newAdmins.length} admins with threshold ${newThreshold}`;

  try {
    // Propose the governance configuration change
    const tx = await governor.propose(targets, values, calldatas, description);
    const receipt = await tx.wait();

    // Extract proposal ID from the ProposalCreated event
    const proposalCreatedEvent = receipt.events?.find(
      (event: any) => event.event === 'ProposalCreated'
    );

    if (!proposalCreatedEvent) {
      throw new Error('ProposalCreated event not found in transaction receipt');
    }

    const proposalId = proposalCreatedEvent.args.id;
    
    console.log(`✅ Governance configuration proposal created successfully!`);
    console.log(`   Proposal ID: ${proposalId}`);
    console.log(`   Transaction hash: ${tx.hash}`);
    console.log(`   Block number: ${receipt.blockNumber}`);
    console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
    
    console.log(`\n📋 Next steps:`);
    console.log(`   1. Check proposal status: yarn hardhat governor:status --proposal-id ${proposalId} --deployment ${deploymentManager.deployment}`);
    console.log(`   2. Approve proposal: yarn hardhat governor:approve --proposal-id ${proposalId} --deployment ${deploymentManager.deployment}`);
    console.log(`   3. Queue proposal: yarn hardhat governor:queue --proposal-id ${proposalId} --deployment ${deploymentManager.deployment}`);
    console.log(`   4. Execute proposal: yarn hardhat governor:execute --proposal-id ${proposalId} --execution-type governance-config --deployment ${deploymentManager.deployment}`);

    return {
      proposalId: proposalId.toString(),
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      newAdmins,
      newThreshold,
      description
    };
  } catch (error) {
    console.error('❌ Failed to create governance configuration proposal:', error);
    throw error;
  }
}
