import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Contract } from 'ethers';

import { manualVerifyContract } from './ManualVerify';
import { BuildFile } from './Types';
import { debug } from './Utils';

export type VerifyArgs =
  | { via: 'artifacts', address: string, constructorArguments: any }
  | { via: 'buildfile', contract: Contract, buildFile: BuildFile, deployArgs: any[] };

export type VerificationStrategy = 'none' | 'eager' | 'lazy';

export async function verifyContract(
  verifyArgs: VerifyArgs,
  hre: HardhatRuntimeEnvironment,
  raise = false,
  retries = 10
): Promise<boolean> {
  let address;
  let success;
  try {
    if (verifyArgs.via === 'artifacts') {
      address = verifyArgs.address;
      await hre.run('verify:verify', {
        address: verifyArgs.address,
        constructorArguments: verifyArgs.constructorArguments,
      });
    } else if (verifyArgs.via === 'buildfile') {
      address = verifyArgs.contract.address;
      await manualVerifyContract(
        verifyArgs.contract,
        verifyArgs.buildFile,
        verifyArgs.deployArgs,
        hre
      );
    } else {
      throw new Error(`Unknown verification via`);
    }
    debug('Contract at address ' + address + ' verified on Etherscan.');
    success = true;
  } catch (e) {
    if (e.message.match(/Already Verified/i)) {
      debug('Contract at address ' + address + ' is already verified on Etherscan');
      success = true;
    } else if (e.message.match(/does not have bytecode/i) && retries > 0) {
      debug('Waiting for ' + address + ' to propagate to Etherscan');
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return await verifyContract(verifyArgs, hre, raise, retries - 1);
    } else {
      if (raise) {
        throw e;
      } else {
        console.error(`Unable to verify contract at ${address}: ${e}`);
        console.error(`Continuing on anyway...`);
        success = false;
      }
    }
  }
  return success;
}
