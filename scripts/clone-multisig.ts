import hre from 'hardhat';
import { DeploymentManager } from '../plugins/deployment_manager/DeploymentManager';
import { SafeFactory } from '@safe-global/safe-core-sdk';
import EthersAdapter from '@safe-global/safe-ethers-lib';

const SRC_NETWORK = process.env['SRC_NETWORK'] ?? 'mainnet';
const DST_NETWORK = process.env['DST_NETWORK'] ?? 'hardhat';

async function main() {
  await hre.changeNetwork(SRC_NETWORK);

  const dm = new DeploymentManager(SRC_NETWORK, 'usdc', hre);

  const signer_ = await dm.getSigner();
  const comet = await dm.contract('comet');
  const guardian = await comet.pauseGuardian();

  // Get owners and threshold from existing multisig
  const GnosisABI = [
    {'constant':true,'inputs':[],'name':'getOwners','outputs':[{'internalType':'address[]','name':'','type':'address[]'}],'payable':false,'stateMutability':'view','type':'function'},
    {'constant':true,'inputs':[],'name':'getThreshold','outputs':[{'internalType':'uint256','name':'','type':'uint256'}],'payable':false,'stateMutability':'view','type':'function'},
  ];
  const GnosisSafeContract = new hre.ethers.Contract(guardian, GnosisABI, hre.ethers.provider);
  const owners = await GnosisSafeContract.getOwners();
  const threshold = await GnosisSafeContract.getThreshold();
  const safeAccountConfig = { owners: owners, threshold: threshold};
  console.log(safeAccountConfig);
  console.log(guardian);

  await hre.changeNetwork(DST_NETWORK);

  const signer = await hre.ethers.provider.getSigner(signer_.address);
  const ethAdapter = new EthersAdapter({ ethers: hre.ethers, signerOrProvider: signer });
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
