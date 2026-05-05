// Quick probe: can we deploy CometExt to Marcus?

import { ethers } from 'hardhat';

async function main() {
  const [admin] = await ethers.getSigners();
  console.log('Deployer:', admin.address);
  const CometExt = await ethers.getContractFactory('contracts/CometExt.sol:CometExt');
  const extConfig = {
    name32: ethers.utils.formatBytes32String('Compound USDC on Rome'),
    symbol32: ethers.utils.formatBytes32String('cUSDCv3'),
  };

  // Get raw deploy tx
  const tx = CometExt.getDeployTransaction(extConfig);
  console.log('Calldata length:', (tx.data as string).length / 2 - 1, 'bytes');

  // Try with explicit gas limit
  const cometExt = await CometExt.deploy(extConfig, { gasLimit: 50_000_000 });
  console.log('Deploy tx hash:', cometExt.deployTransaction.hash);
  const receipt = await cometExt.deployTransaction.wait();
  console.log('Mined block:', receipt.blockNumber, 'gas used:', receipt.gasUsed.toString());
  console.log('CometExt address:', cometExt.address);
}

main().catch((e) => { console.error(e); process.exit(1); });
