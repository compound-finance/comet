import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { DeploymentManager } from '../../../plugins/deployment_manager';

export async function impersonateAddress(dm: DeploymentManager, address: string): Promise<SignerWithAddress> {
  await dm.hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [address],
  });
  return await dm.getSigner(address);
}
