// 1. Collect all the users from the start of comet to start of campaign block
// 2. Get current accrued values for all the users
// 3. Generate input data for merkle tree
// 4. Generate tree
// 5. Save JSON

// 6. Github workflow

// 7. Verify with Dune Dashboard

// To run script
// yarn run rewards-v2 -- --network mainnet
// Or use hardhat task
// yarn hardhat generateMerkleTree --network mainnet --deployment usdc --type finish --blocknumber 21114579

import hre from 'hardhat';
import { CampaignType } from './types';
import { generateMerkleTreeForCampaign } from './utils';

const main = async () => {
  console.log('Start Rewards V2 hash generation');

  let { NETWORK, DEPLOYMENT, BLOCK_NUMBER, TYPE } = process.env;

  await generateMerkleTreeForCampaign(NETWORK, DEPLOYMENT, +BLOCK_NUMBER, TYPE as CampaignType, hre);
};

main().then().catch(console.error);