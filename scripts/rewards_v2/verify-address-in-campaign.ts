import hre from 'hardhat';
import { DeploymentManager } from '../../plugins/deployment_manager';
import { CometInterface } from '../../build/types';
import { multicall } from './utils';
import { multicallAddresses } from './constants';
import fs from 'fs/promises';
import { IncentivizationCampaignData, Proof } from './types';

const verifyUserInCampaign = async (address: string, campaignFileName: string, network: string, deployment: string) => {
  const file = campaignFileName.endsWith('.json') ? campaignFileName : `${campaignFileName}.json`;
  const filePath = `./campaigns/${network}-${deployment}/${file}`;
  const merkleTree = JSON.parse((await fs.readFile(filePath)).toString()) as IncentivizationCampaignData;
  const blockNumber = merkleTree.blockNumber;
  const addressInCampaign = merkleTree.data[address.toLowerCase()];
  const getAccrueData = await getAddressAccrueValue(address, network, deployment, blockNumber);

  if (!addressInCampaign?.accrue && getAccrueData.accrue === '0') {
    console.log(`Address ${address} did not interact with ${network}-${deployment} before ${blockNumber} block`);
    const { left, right } = getNeighborAddresses(address, merkleTree.data) as { left: string, right: string };
    return { address: address.toLowerCase(), comet: getAccrueData.comet, blockNumber: getAccrueData.blockNumber, accrue: addressInCampaign?.accrue || '0', proof: [merkleTree.data[left.toLowerCase()], merkleTree.data[right.toLowerCase()]] };
  }

  if (getAccrueData.accrue !== addressInCampaign?.accrue) {
    throw new Error(`Error. Address ${address} has accrue ${getAccrueData.accrue}, but in campaign ${campaignFileName} it is ${addressInCampaign.accrue}`);
  }

  console.log(`Address ${address} did not interact with ${network}-${deployment} before ${blockNumber} block`);

  return { address: address.toLowerCase(), comet: getAccrueData.comet, blockNumber: getAccrueData.blockNumber, accrue: addressInCampaign.accrue, proof: [addressInCampaign] };
};

const getAddressAccrueValue = async (address: string, network: string, deployment: string, blockNumber: number) => {
  const dm = new DeploymentManager(
    network,
    deployment,
    hre,
    {
      writeCacheToDisk: true,
      verificationStrategy: 'eager',
    }
  );

  await dm.spider();

  const contracts = await dm.contracts();
  const comet = contracts.get('comet') as CometInterface;

  const multicallAddress = multicallAddresses[network];
  if (!multicallAddress) {
    throw new Error('Network is not supported');
  }

  const { data } = await multicall(multicallAddress, comet.address, [address], blockNumber, dm);
  const [addr, accrue] = Object.entries(data)[0] as [string, string];

  return { address: addr, accrue, blockNumber, comet: comet.address };
};

const logVerificationResponse = (data: { address: string, comet: string, blockNumber: number, accrue: string, proof: Proof[] }) => {
  if (!data) return;
  console.table(data);
  data.proof.forEach(proof => console.log(proof));
};

function getNeighborAddresses(inputKey: string, obj: {
    [network: string]: Proof;
}) {
  const sortedKeys = Object.keys(obj).sort();

  let leftNeighbor = null;
  let rightNeighbor = null;

  for (const key of sortedKeys) {
    if (key < inputKey) {
      leftNeighbor = key;
    } else if (key > inputKey && rightNeighbor === null) {
      rightNeighbor = key;
      break;
    }
  }

  return {
    left: leftNeighbor,
    right: rightNeighbor
  };
}

// ADDRESS=0x00002abe0c2edbdc822c7a55a91e645cc1d60000 CAMPAIGN='1732326736947-21247270-start.json' DEPLOYMENT=usdt BLOCK_NUMBER=21074594 yarn run rewards-v2-verify-address -- --network mainnet

(async () => {
  let { ADDRESS, CAMPAIGN, NETWORK, DEPLOYMENT, BLOCK_NUMBER } = process.env;

  if (!ADDRESS || !CAMPAIGN || !NETWORK || !DEPLOYMENT || !BLOCK_NUMBER) {
    throw new Error('Missing some parameters');
  }

  const address = ADDRESS;
  const campaign = CAMPAIGN;
  const network = NETWORK;
  const deployment = DEPLOYMENT;
  const blockNumber = +BLOCK_NUMBER;

  // getAddressAccrueValue allows getting address's accrue value in a specified comet in the specified block 
  const response = await getAddressAccrueValue(address, network, deployment, blockNumber);
  console.log(`Address ${response.address} has ${response.accrue} accrue value in ${network}-${deployment} Comet@${response.comet} on ${response.blockNumber} block`);

  // verifyUserInCampaign allows to check if a user is in the campaign and return the proof.
  //If user didn't interact with Comet, user will receive proof of neighbors to claim the rewards
  //If user interacted with Comet, but was not included in the file, the script will throw the error
  const verifyUserInCampaignResponse = await verifyUserInCampaign(address, campaign, network, deployment);
  logVerificationResponse(verifyUserInCampaignResponse);
})();