import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { proposeCometUpgrade } from '../deploy/NetworkExtension';

export default async function proposeCometUpgradeTask(
  hre: HardhatRuntimeEnvironment, 
  newImplementationAddress: string
) {
  if (!newImplementationAddress) {
    throw new Error('New implementation address is required');
  }
  
  const deploymentManager = (hre as any).deploymentManager;
  const trace = deploymentManager.tracer();
  
  trace(`Proposing Comet upgrade to ${newImplementationAddress}...`);
  
  try {
    const admin = await deploymentManager.getSigner();
    return await proposeCometUpgrade(deploymentManager, newImplementationAddress, admin);
  } catch (error) {
    trace(`❌ Failed to propose Comet upgrade: ${error}`);
    throw error;
  }
} 