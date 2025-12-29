import { DeploymentManager } from '../plugins/deployment_manager/DeploymentManager';
import { SafeFactory } from '@safe-global/safe-core-sdk';
import EthersAdapter from '@safe-global/safe-ethers-lib';
import { nonForkedHreForBase, forkedHreForBase } from '../plugins/scenario/utils/hreForBase';
import { ethers } from 'ethers';
import type { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

const SRC_NETWORK = process.env['SRC_NETWORK'] ?? 'mainnet';
const DST_NETWORK = process.env['DST_NETWORK'] ?? 'hardhat';

async function main() {
  const hreSRC = await forkedHreForBase({ name: SRC_NETWORK, network: SRC_NETWORK, deployment: '' });

  const dm = new DeploymentManager(SRC_NETWORK, 'usdc', hreSRC);

  const comet = await dm.contract('comet');
  const guardian = await comet.pauseGuardian();

  // Get owners and threshold from existing multisig
  const GnosisABI = [
    {'constant':true,'inputs':[],'name':'getOwners','outputs':[{'internalType':'address[]','name':'','type':'address[]'}],'payable':false,'stateMutability':'view','type':'function'},
    {'constant':true,'inputs':[],'name':'getThreshold','outputs':[{'internalType':'uint256','name':'','type':'uint256'}],'payable':false,'stateMutability':'view','type':'function'},
  ];
  const GnosisSafeContract = new hreSRC.ethers.Contract(guardian, GnosisABI, hreSRC.ethers.provider);
  const owners = await GnosisSafeContract.getOwners();
  const threshold = await GnosisSafeContract.getThreshold();
  const safeAccountConfig = { owners: owners, threshold: threshold};
  console.log(safeAccountConfig);
  console.log(guardian);

  const hreDST = await nonForkedHreForBase({ name: '', network: DST_NETWORK, deployment: '' });
  const wallet = new ethers.Wallet(process.env.ETH_PK!, hreDST.ethers.provider);
  const signer: SignerWithAddress = wallet as unknown as SignerWithAddress;

  const ethAdapter = new EthersAdapter({ ethers: hreDST.ethers as any, signerOrProvider: signer });
  const safeFactory = await SafeFactory.create({ ethAdapter: ethAdapter });
  const safeSdk = await safeFactory.deploySafe({ safeAccountConfig });
  console.log(safeSdk);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });