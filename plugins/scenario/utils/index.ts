import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { DeploymentManager } from '../../../plugins/deployment_manager';

export async function impersonateAddress(dm: DeploymentManager, address: string, value?: bigint): Promise<SignerWithAddress> {
  if (value) {
    console.log(address)
    await dm.hre.network.provider.send('tenderly_setBalance', [[address], "0x152D02C7E14AF6800000"]);
    
    const signer = await dm.getSigner();
    await dm.hre.network.provider.send('tenderly_setBalance', [[signer.address], "0x152D02C7E14AF6800000"]);
    console.log(signer.address)
    console.log(await signer.getBalance())
    console.log("Sending value to address", address, "value", value.toString());
    await signer.sendTransaction({ to: address, value });

    // await dm.hre.network.provider.request({
    //   method: 'tenderly_impersonateAccount',
    //   params: [address],
    // });


    const impersonateSigner = await dm.getSigner(address);
    //await impersonateSigner.sendTransaction({ to: address, value });
    console.log("FFUHUFHFHF");
  }
  // await dm.hre.network.provider.request({
  //   method: 'tenderly_impersonateAccount',
  //   params: [address],
  // });
  return await dm.getSigner(address);
}
