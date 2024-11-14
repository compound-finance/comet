import { CometContext, CometProperties, scenario } from './context/CometContext';
import { expect } from 'chai';
import { ethers, exp, Numeric } from '../test/helpers';
import { isRewardSupported, matchesDeployment } from './utils';
import { Contract, ContractReceipt, Signer } from 'ethers';
import { ERC20__factory } from '../build/types';
import {World} from '../plugins/scenario';
import { getLatestStartAndFinishMerkleTreeForCampaign } from '../scripts/rewards_v2/utils';
import { getConfigForScenario } from './utils/scenarioHelper';
import {
  CometRewardsV2,
  FaucetToken__factory,
} from '../build/types';
import { TokenMultiplierStruct } from '../build/types/CometRewardsV2';
import CometActor from './context/CometActor';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

function calculateRewardsOwed(
  userBalance: bigint,
  totalBalance: bigint,
  speed: bigint,
  timeElapsed: number,
  trackingIndexScale: bigint,
  rewardTokenScale: bigint,
  rescaleFactor: bigint,
  startAccrued: bigint = 0n,
  finishAccrued: bigint = 0n
): bigint {
  // accrued = (user balance / total balance) * (speed / trackingIndexScale) * time * reward token scale
  const accrued = userBalance * speed * BigInt(timeElapsed) * rewardTokenScale / totalBalance / trackingIndexScale;

  // truncate using rescaleFactor
  if(finishAccrued > 0n) {
    return finishAccrued / rescaleFactor * rescaleFactor;
  }
  if(startAccrued <= accrued)
    return ((accrued - startAccrued) / rescaleFactor * rescaleFactor);
  else throw new Error('Error calculating rewards owed');
}

async function createNewCampaign(
  comet: Contract,
  rewardsV2: CometRewardsV2,
  admin: Signer,
  root: string,
  tokens: string[],
  duration: number,
  withMultiplier: boolean,
  multipliers?: number[]
) : Promise<Numeric> {
  if(withMultiplier) {
    if(tokens.length !== multipliers.length) throw new Error('Arrays length mismatch');
    const assets: TokenMultiplierStruct[] = [];

    for (let i = 0; i < tokens.length; i++) {
      assets.push({ token: tokens[i], multiplier: multipliers[i].toString()});
    }

    const tx = await rewardsV2.setNewCampaignWithCustomTokenMultiplier(
      comet.address,
      root,
      assets,
      duration
    );

    // find NewCampaign event
    const receipt = await tx.wait();
    const event = receipt.events?.find((e) => e.event === 'NewCampaign');
    const campaignId = event?.args?.campaignId;
    return campaignId;
  }
  else {
    const tx = await rewardsV2.connect(admin).setNewCampaign(
      comet.address,
      root,
      tokens,
      duration
    );

    // find NewCampaign event
    const receipt = await tx.wait();
    const event = receipt.events?.find((e) => e.event === 'NewCampaign');
    const campaignId = event?.args?.campaignId;
    return campaignId;
  }
}

async function getProof(address : string, tree: StandardMerkleTree<string[]>) {
  for (const [i, v] of tree.entries()) {
    if (v[0] === address) {
      const proof = tree.getProof(i);
      return { proof, v };
    }
  }
  return undefined;
}

function addressToBigInt(address: string): bigint {
  return BigInt(address.toLowerCase());
}

async function getProofsForNewUser(address: string, tree: StandardMerkleTree<string[]>) {
  const targetAddressBigInt = addressToBigInt(address);
  let previousAddress = ethers.constants.AddressZero;
  let previousAddressBigInt = addressToBigInt(previousAddress);

  for (const [i, v] of tree.entries()) {
    const currentAddress = v[0];
    const currentAddressBigInt = addressToBigInt(currentAddress);
    // trow error if currentAddress is equal to targetAddress
    if (currentAddressBigInt === targetAddressBigInt) {
      throw new Error('Address already exists in the tree');
    }

    // Check if targetAddress is between previousAddress and currentAddress
    if (
      previousAddressBigInt < targetAddressBigInt &&
      targetAddressBigInt < currentAddressBigInt
    ) {
      // i will always be greater than 0 since first address in the tree should always be address(0)
      //    and no address can be less than address(0)
      const proofA = tree.getProof(i - 1);
      const proofB = tree.getProof(i);

      return {
        proofA,
        proofB,
        indexA: i - 1,
        indexB: i,
        addressA: previousAddress,
        addressB: currentAddress,
        accruedA: BigInt(v[2]),
        accruedB: BigInt(tree.at(i)[2])
      };
    }

    // Update previous address for next iteration
    previousAddress = currentAddress;
    previousAddressBigInt = currentAddressBigInt;
  }

  // If we reach here, the address was not found in the tree
  return undefined;
}


scenario.only(
  'Comet#rewardsV2 > can claim supply rewards for self as existing user in new campaign with no finish tree',
  {
    filter: async (ctx) => await isRewardSupported(ctx),
    tokenBalances: async (ctx: CometContext) => (
      {
        albert: { $base: ` == ${+getConfigForScenario(ctx).rewardsBase}`}, // in units of asset, not wei
      }
    ),
  },
  async ({ comet, rewardsV2, actors},  context, world) => {
    const { albert } = actors;
    const deploymentManager = world.deploymentManager;
    const { startTree : startMerkleTree, finishTree : finishMerkleTree } = await getLatestStartAndFinishMerkleTreeForCampaign(
      deploymentManager.network,
      deploymentManager.deployment,
      deploymentManager.hre
    );

    // impersonate someone from the tree with accrue > 1000
    let addressToImpersonate: string;
    let userIndex = 0;
    let accrued = 0;
    for(let i = 0; i < startMerkleTree.length; i++) {
      const [address, index, accrue] = startMerkleTree.at(i);
      if(+accrue >= 10000) {
        addressToImpersonate = address;
        accrued = +accrue;
        userIndex = +index;
        break;
      }
    }
    await deploymentManager.hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [addressToImpersonate],
    });
    const signer = await deploymentManager.getSigner(addressToImpersonate);
    // set balance
    await deploymentManager.hre.ethers.provider.send('hardhat_setBalance', [
      signer.address,
      deploymentManager.hre.ethers.utils.hexStripZeros(deploymentManager.hre.ethers.utils.parseUnits('100', 'ether').toHexString()),
    ]);

    const jay = new CometActor('jay', signer, signer.address, context);

    const FaucetTokenFactory = (await deploymentManager.hre.ethers.getContractFactory('FaucetToken')) as FaucetToken__factory;
  
    const rewardTokens = {
      rewardToken0: await FaucetTokenFactory.deploy(exp(100_000, 18), 'RewardToken0', 18, 'RewardToken0'),
      rewardToken1: await FaucetTokenFactory.deploy(exp(100_000, 6), 'RewardToken1', 6, 'RewardToken1')
    };
    const root = startMerkleTree.root;

    await rewardTokens.rewardToken0.transfer(rewardsV2.address, exp(100_000, 18));
    await rewardTokens.rewardToken1.transfer(rewardsV2.address, exp(100_000, 6));

    const newCampaignId = await createNewCampaign(
      comet,
      rewardsV2,
      actors.admin.signer,
      root,
      [rewardTokens.rewardToken0.address, rewardTokens.rewardToken1.address],
      90000, // 1 day + 1 hour
      false
    );

    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const baseScale = (await comet.baseScale()).toBigInt();
    
    if((await jay.getCometBaseBalance()) > 0n) {
      await comet.connect(jay.signer).transfer(albert.address, await jay.getCometBaseBalance());
    }
    else if((await comet.borrowBalanceOf(jay.address)).toBigInt() > 0n) {
      await albert.transferErc20(
        baseAssetAddress,
        jay.address,
        (await comet.borrowBalanceOf(jay.address)).toBigInt()
      );
      await baseAsset.approve(jay, comet.address);
      await comet.connect(jay.signer).supply(baseAssetAddress, (await comet.borrowBalanceOf(jay.address)).toBigInt());
    }
    
    await albert.transferErc20(
      baseAssetAddress,
      jay.address,
      BigInt(getConfigForScenario(context).rewardsBase) * baseScale
    );

    const tokensAndConfig = await rewardsV2.rewardConfig(comet.address, newCampaignId);
    await baseAsset.approve(jay, comet.address);
    await jay.safeSupplyAsset({ asset: baseAssetAddress, amount: BigInt(getConfigForScenario(context).rewardsBase) * baseScale });

    const tokens = tokensAndConfig[0];
    const configs = tokensAndConfig[1];

    const supplyTimestamp = await world.timestamp();
    const jayBalance = await jay.getCometBaseBalance();
    const totalSupplyBalance = (await comet.totalSupply()).toBigInt();

    await world.increaseTime(86400); // fast forward a day
    const preTxnTimestamp = await world.timestamp();

    await comet.connect(albert.signer).accrueAccount(jay.address);
    const rewardsOwedBefore = await rewardsV2.callStatic.getRewardsOwedBatch(
      comet.address,
      newCampaignId,
      jay.address,
      accrued,
      0,
      false
    );    
    const txn = await (await rewardsV2.connect(jay.signer).claim(
      comet.address,
      newCampaignId,
      jay.address,
      false,
      {
        startIndex: userIndex,
        finishIndex: userIndex,
        startAccrued: accrued.toString(),
        finishAccrued: accrued.toString(),
        startMerkleProof: (await getProof(jay.address, startMerkleTree)).proof,
        finishMerkleProof: []
      }
    )).wait();
    const rewardsOwedAfter = await rewardsV2.callStatic.getRewardsOwedBatch(
      comet.address,
      newCampaignId,
      jay.address,
      accrued,
      0,
      false
    );
    const postTxnTimestamp = await world.timestamp();
    const timeElapsed = postTxnTimestamp - preTxnTimestamp;
    const supplySpeed = (await comet.baseTrackingSupplySpeed()).toBigInt();
    const trackingIndexScale = (await comet.trackingIndexScale()).toBigInt();
    const timestampDelta = preTxnTimestamp - supplyTimestamp;
    const totalSupplyPrincipal = (await comet.totalsBasic()).totalSupplyBase.toBigInt();
    const baseMinForRewards = (await comet.baseMinForRewards()).toBigInt();
    let expectedRewardsOwed = 0n;
    let expectedRewardsReceived = 0n;

    for(let i = 0; i < tokens.length - 1; i++) {
      const rewardToken = new Contract(
        tokens[i],
        ERC20__factory.createInterface(),
        world.deploymentManager.hre.ethers.provider
      );
      const rewardScale = exp(1, await rewardToken.decimals());

      if (totalSupplyPrincipal >= baseMinForRewards) {
        expectedRewardsOwed = calculateRewardsOwed(
          jayBalance,
          totalSupplyBalance,
          supplySpeed,
          timestampDelta + 1,
          trackingIndexScale,
          rewardScale,
          configs[i].rescaleFactor.toBigInt(),
          BigInt(accrued)
        );
        expectedRewardsReceived = calculateRewardsOwed(
          jayBalance,
          totalSupplyBalance,
          supplySpeed,
          timestampDelta + timeElapsed - 1,
          trackingIndexScale,
          rewardScale,
          configs[i].rescaleFactor.toBigInt(),
          BigInt(accrued)
        );
      }

      // Occasionally `timestampDelta` is equal to 86401
      expect(timestampDelta).to.be.greaterThanOrEqual(86400);
      expect(rewardsOwedBefore[i].owed.toBigInt()).to.be.equal(expectedRewardsOwed);
      expect(await rewardToken.balanceOf(jay.address)).to.be.equal(rewardsOwedBefore[i].owed);
      expect(await rewardToken.balanceOf(jay.address)).to.be.equal(expectedRewardsReceived);
      expect(rewardsOwedAfter[i].owed.toBigInt()).to.be.equal(0n);
    }
    return txn; // return txn to measure gas
  });

scenario.only(
  'Comet#rewardsV2 > can claim supply rewards for self as a new user in new campaign with no finish tree',
  {
    filter: async (ctx) => await isRewardSupported(ctx),
    tokenBalances: async (ctx: CometContext) => (
      {
        albert: { $base: ` == ${+getConfigForScenario(ctx).rewardsBase * 2}`}, // in units of asset, not wei
      }
    ),
  },
  async ({ comet, rewardsV2, actors},  context, world) => {
    const { albert } = actors;
    const deploymentManager = world.deploymentManager;
    const { startTree : startMerkleTree, finishTree : finishMerkleTree } = await getLatestStartAndFinishMerkleTreeForCampaign(
      deploymentManager.network,
      deploymentManager.deployment,
      deploymentManager.hre
    );

    const FaucetTokenFactory = (await deploymentManager.hre.ethers.getContractFactory('FaucetToken')) as FaucetToken__factory;
  
    const rewardTokens = {
      rewardToken0: await FaucetTokenFactory.deploy(exp(100_000, 18), 'RewardToken0', 18, 'RewardToken0'),
      rewardToken1: await FaucetTokenFactory.deploy(exp(100_000, 6), 'RewardToken1', 6, 'RewardToken1')
    };
    const root = startMerkleTree.root;

    await rewardTokens.rewardToken0.transfer(rewardsV2.address, exp(100_000, 18));
    await rewardTokens.rewardToken1.transfer(rewardsV2.address, exp(100_000, 6));

    const newCampaignId = await createNewCampaign(
      comet,
      rewardsV2,
      actors.admin.signer,
      root,
      [rewardTokens.rewardToken0.address, rewardTokens.rewardToken1.address],
      90000, // 1 day + 1 hour
      false
    );

    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const baseScale = (await comet.baseScale()).toBigInt();

    const tokensAndConfig = await rewardsV2.rewardConfig(comet.address, newCampaignId);
    await baseAsset.approve(albert, comet.address);
    await albert.safeSupplyAsset({ asset: baseAssetAddress, amount: BigInt(getConfigForScenario(context).rewardsBase) * baseScale });

    const tokens = tokensAndConfig[0];
    const configs = tokensAndConfig[1];

    const supplyTimestamp = await world.timestamp();
    const albertBalance = await albert.getCometBaseBalance();
    const totalSupplyBalance = (await comet.totalSupply()).toBigInt();

    await world.increaseTime(86400); // fast forward a day
    const preTxnTimestamp = await world.timestamp();

    await comet.connect(albert.signer).accrueAccount(albert.address);
    const rewardsOwedBefore = await rewardsV2.callStatic.getRewardsOwedBatch(
      comet.address,
      newCampaignId,
      albert.address,
      0,
      0,
      false
    );   
    const { proofA, proofB, indexA, indexB, addressA, addressB, accruedA, accruedB } = await getProofsForNewUser(albert.address, startMerkleTree) || {};

    const txn = await (await rewardsV2.connect(albert.signer).claimForNewMember(
      comet.address,
      newCampaignId,
      albert.address,
      false,
      [addressA, addressB],
      [
        {
          startIndex: indexA,
          finishIndex: 0,
          startAccrued: BigInt(accruedA),
          finishAccrued: 0n,
          startMerkleProof: proofA,
          finishMerkleProof: []
        },
        {
          startIndex: indexB,
          finishIndex: 0,
          startAccrued: BigInt(accruedB),
          finishAccrued: 0n,
          startMerkleProof: proofB,
          finishMerkleProof: []
        }
      ],
      {
        finishIndex: 0,
        finishAccrued: 0n,
        finishMerkleProof: []
      }
    )).wait();
    const rewardsOwedAfter = await rewardsV2.callStatic.getRewardsOwedBatch(
      comet.address,
      newCampaignId,
      albert.address,
      0,
      0,
      false
    );
    const postTxnTimestamp = await world.timestamp();
    const timeElapsed = postTxnTimestamp - preTxnTimestamp;
    const supplySpeed = (await comet.baseTrackingSupplySpeed()).toBigInt();
    const trackingIndexScale = (await comet.trackingIndexScale()).toBigInt();
    const timestampDelta = preTxnTimestamp - supplyTimestamp;
    const totalSupplyPrincipal = (await comet.totalsBasic()).totalSupplyBase.toBigInt();
    const baseMinForRewards = (await comet.baseMinForRewards()).toBigInt();
    let expectedRewardsOwed = 0n;
    let expectedRewardsReceived = 0n;

    for(let i = 0; i < tokens.length - 1; i++) {
      const rewardToken = new Contract(
        tokens[i],
        ERC20__factory.createInterface(),
        world.deploymentManager.hre.ethers.provider
      );
      const rewardScale = exp(1, await rewardToken.decimals());

      if (totalSupplyPrincipal >= baseMinForRewards) {
        expectedRewardsOwed = calculateRewardsOwed(
          albertBalance,
          totalSupplyBalance,
          supplySpeed,
          timestampDelta + 1,
          trackingIndexScale,
          rewardScale,
          configs[i].rescaleFactor.toBigInt()
        );
        expectedRewardsReceived = calculateRewardsOwed(
          albertBalance,
          totalSupplyBalance,
          supplySpeed,
          timestampDelta + timeElapsed - 1,
          trackingIndexScale,
          rewardScale,
          configs[i].rescaleFactor.toBigInt()
        );
      }

      // Occasionally `timestampDelta` is equal to 86401
      expect(timestampDelta).to.be.greaterThanOrEqual(86400);
      expect(rewardsOwedBefore[i].owed.toBigInt()).to.be.equal(expectedRewardsOwed);
      expect(await rewardToken.balanceOf(albert.address)).to.be.equal(rewardsOwedBefore[i].owed);
      expect(await rewardToken.balanceOf(albert.address)).to.be.equal(expectedRewardsReceived);
      expect(rewardsOwedAfter[i].owed.toBigInt()).to.be.equal(0n);
    }
    return txn; // return txn to measure gas
  });

// scenario(
//   'Comet#rewardsV2 > manager can claimTo supply rewards from a managed account',
//   {
//     filter: async (ctx) => await isRewardSupported(ctx) && !matchesDeployment(ctx, [{network: 'mainnet', deployment: 'weth'}]),
//     tokenBalances: {
//       albert: { $base: ' == 100' }, // in units of asset, not wei
//     },
//   },
//   async ({ comet, rewards, actors }, context, world) => {
//     const { albert, betty } = actors;
//     const baseAssetAddress = await comet.baseToken();
//     const baseAsset = context.getAssetByAddress(baseAssetAddress);
//     const baseScale = (await comet.baseScale()).toBigInt();

//     const [rewardTokenAddress, rescaleFactor] = await rewards.rewardConfig(comet.address);
//     const rewardToken = new Contract(
//       rewardTokenAddress,
//       ERC20__factory.createInterface(),
//       world.deploymentManager.hre.ethers.provider
//     );
//     const rewardScale = exp(1, await rewardToken.decimals());

//     await albert.allow(betty, true); // Albert allows Betty to manage his account
//     await baseAsset.approve(albert, comet.address);
//     await albert.safeSupplyAsset({ asset: baseAssetAddress, amount: 100n * baseScale });

//     expect(await rewardToken.balanceOf(albert.address)).to.be.equal(0n);

//     const supplyTimestamp = await world.timestamp();
//     const albertBalance = await albert.getCometBaseBalance();
//     const totalSupplyBalance = (await comet.totalSupply()).toBigInt();

//     await world.increaseTime(86400); // fast forward a day
//     const preTxnTimestamp = await world.timestamp();

//     const rewardsOwedBefore = (await rewards.callStatic.getRewardOwed(comet.address, albert.address)).owed.toBigInt();
//     const txn = await (await rewards.connect(betty.signer).claimTo(comet.address, albert.address, betty.address, true)).wait();
//     const rewardsOwedAfter = (await rewards.callStatic.getRewardOwed(comet.address, albert.address)).owed.toBigInt();

//     const postTxnTimestamp = await world.timestamp();
//     const timeElapsed = postTxnTimestamp - preTxnTimestamp;

//     const supplySpeed = (await comet.baseTrackingSupplySpeed()).toBigInt();
//     const trackingIndexScale = (await comet.trackingIndexScale()).toBigInt();
//     const timestampDelta = preTxnTimestamp - supplyTimestamp;
//     const totalSupplyPrincipal = (await comet.totalsBasic()).totalSupplyBase.toBigInt();
//     const baseMinForRewards = (await comet.baseMinForRewards()).toBigInt();
//     let expectedRewardsOwed = 0n;
//     let expectedRewardsReceived = 0n;
//     if (totalSupplyPrincipal >= baseMinForRewards) {
//       expectedRewardsOwed = calculateRewardsOwed(albertBalance, totalSupplyBalance, supplySpeed, timestampDelta, trackingIndexScale, rewardScale, rescaleFactor.toBigInt());
//       expectedRewardsReceived = calculateRewardsOwed(albertBalance, totalSupplyBalance, supplySpeed, timestampDelta + timeElapsed, trackingIndexScale, rewardScale, rescaleFactor.toBigInt());
//     }

//     // Occasionally `timestampDelta` is equal to 86401
//     expect(timestampDelta).to.be.greaterThanOrEqual(86400);
//     expect(rewardsOwedBefore).to.be.equal(expectedRewardsOwed);
//     expect(await rewardToken.balanceOf(betty.address)).to.be.equal(expectedRewardsReceived);
//     expect(rewardsOwedAfter).to.be.equal(0n);

//     return txn; // return txn to measure gas
//   }
// );

// scenario(
//   'Comet#rewardsV2 > can claim borrow rewards for self',
//   {
//     filter: async (ctx) => await isRewardSupported(ctx),
//     tokenBalances: {
//       albert: { $asset0: ' == 10000' }, // in units of asset, not wei
//       $comet: { $base: ' >= 1000 ' }
//     },
//   },
//   async ({ comet, rewards, actors }, context, world) => {
//     const { albert } = actors;
//     const { asset: collateralAssetAddress, scale: scaleBN } = await comet.getAssetInfo(0);
//     const collateralAsset = context.getAssetByAddress(collateralAssetAddress);
//     const scale = scaleBN.toBigInt();
//     const toSupply = 10_000n * scale;
//     const baseAssetAddress = await comet.baseToken();
//     const baseScale = (await comet.baseScale()).toBigInt();
//     const toBorrow = 1_000n * baseScale;

//     const { rescaleFactor } = await context.getRewardConfig();
//     const rewardToken = await context.getRewardToken();
//     const rewardScale = exp(1, await rewardToken.decimals());

//     await collateralAsset.approve(albert, comet.address);
//     await albert.safeSupplyAsset({ asset: collateralAssetAddress, amount: toSupply });
//     await albert.withdrawAsset({ asset: baseAssetAddress, amount: toBorrow });

//     expect(await rewardToken.balanceOf(albert.address)).to.be.equal(0n);

//     const borrowTimestamp = await world.timestamp();
//     const albertBalance = await albert.getCometBaseBalance();
//     const totalBorrowBalance = (await comet.totalBorrow()).toBigInt();

//     await world.increaseTime(86400); // fast forward a day
//     const preTxnTimestamp = await world.timestamp();

//     const rewardsOwedBefore = (await rewards.callStatic.getRewardOwed(comet.address, albert.address)).owed.toBigInt();
//     const txn = await (await rewards.connect(albert.signer).claim(comet.address, albert.address, true)).wait();
//     const rewardsOwedAfter = (await rewards.callStatic.getRewardOwed(comet.address, albert.address)).owed.toBigInt();

//     const postTxnTimestamp = await world.timestamp();
//     const timeElapsed = postTxnTimestamp - preTxnTimestamp;

//     const borrowSpeed = (await comet.baseTrackingBorrowSpeed()).toBigInt();
//     const trackingIndexScale = (await comet.trackingIndexScale()).toBigInt();
//     const timestampDelta = preTxnTimestamp - borrowTimestamp;
//     const totalBorrowPrincipal = (await comet.totalsBasic()).totalBorrowBase.toBigInt();
//     const baseMinForRewards = (await comet.baseMinForRewards()).toBigInt();
//     let expectedRewardsOwed = 0n;
//     let expectedRewardsReceived = 0n;
//     if (totalBorrowPrincipal >= baseMinForRewards) {
//       expectedRewardsOwed = calculateRewardsOwed(-albertBalance, totalBorrowBalance, borrowSpeed, timestampDelta, trackingIndexScale, rewardScale, rescaleFactor.toBigInt());
//       expectedRewardsReceived = calculateRewardsOwed(-albertBalance, totalBorrowBalance, borrowSpeed, timestampDelta + timeElapsed, trackingIndexScale, rewardScale, rescaleFactor.toBigInt());
//     }

//     // Occasionally `timestampDelta` is equal to 86401
//     expect(timestampDelta).to.be.greaterThanOrEqual(86400);
//     expect(rewardsOwedBefore).to.be.equal(expectedRewardsOwed);
//     expect(await rewardToken.balanceOf(albert.address)).to.be.equal(expectedRewardsReceived);
//     expect(rewardsOwedAfter).to.be.equal(0n);

//     return txn; // return txn to measure gas
//   }
// );

// const MULTIPLIERS = [
//   exp(55, 18),
//   exp(10, 18),
//   exp(1, 18),
//   exp(0.01, 18),
//   exp(0.00355, 18)
// ];

// for (let i = 0; i < MULTIPLIERS.length; i++) {
//   scenario(
//     `Comet#rewardsV2 > can claim supply rewards on scaling rewards contract with multiplier of ${MULTIPLIERS[i]}`,
//     {
//       filter: async (ctx) => await isRewardSupported(ctx),
//       tokenBalances: {
//         albert: { $base: ' == 100' }, // in units of asset, not wei
//       },
//     },
//     async (properties, context, world) => {
//       return await testScalingReward(properties, context, world, MULTIPLIERS[i]);
//     }
//   );
// }

// async function testScalingReward(properties: CometProperties, context: CometContext, world: World, multiplier: bigint): Promise<void | ContractReceipt> {
//   const { comet, actors, rewards } = properties;
//   const { albert } = actors;
//   const baseAssetAddress = await comet.baseToken();
//   const baseAsset = context.getAssetByAddress(baseAssetAddress);
//   const baseScale = (await comet.baseScale()).toBigInt();

//   const [rewardTokenAddress, rescaleFactorWithoutMultiplier] = await rewards.rewardConfig(comet.address);
//   // XXX maybe try with a different reward token as well
//   const rewardToken = new Contract(
//     rewardTokenAddress,
//     ERC20__factory.createInterface(),
//     world.deploymentManager.hre.ethers.provider
//   );
//   const rewardDecimals = await rewardToken.decimals();
//   const rewardScale = exp(1, rewardDecimals);

//   // Deploy new rewards contract with a multiplier
//   const newRewards = await world.deploymentManager.deploy<CometRewards, [string]>(
//     'newRewards',
//     'CometRewards.sol',
//     [albert.address]
//   );
//   await newRewards.connect(albert.signer).setRewardConfigWithMultiplier(comet.address, rewardTokenAddress, multiplier);
//   await context.sourceTokens(exp(1_000, rewardDecimals), rewardTokenAddress, newRewards.address);

//   await baseAsset.approve(albert, comet.address);
//   await albert.safeSupplyAsset({ asset: baseAssetAddress, amount: 100n * baseScale });

//   expect(await rewardToken.balanceOf(albert.address)).to.be.equal(0n);

//   const supplyTimestamp = await world.timestamp();
//   const albertBalance = await albert.getCometBaseBalance();
//   const totalSupplyBalance = (await comet.totalSupply()).toBigInt();

//   await world.increaseTime(86400); // fast forward a day
//   const preTxnTimestamp = await world.timestamp();

//   const newRewardsOwedBefore = (await newRewards.callStatic.getRewardOwed(comet.address, albert.address)).owed.toBigInt();
//   const txn = await (await newRewards.connect(albert.signer).claim(comet.address, albert.address, true)).wait();
//   const newRewardsOwedAfter = (await newRewards.callStatic.getRewardOwed(comet.address, albert.address)).owed.toBigInt();

//   const postTxnTimestamp = await world.timestamp();
//   const timeElapsed = postTxnTimestamp - preTxnTimestamp;

//   const supplySpeed = (await comet.baseTrackingSupplySpeed()).toBigInt();
//   const trackingIndexScale = (await comet.trackingIndexScale()).toBigInt();
//   const timestampDelta = preTxnTimestamp - supplyTimestamp;
//   const totalSupplyPrincipal = (await comet.totalsBasic()).totalSupplyBase.toBigInt();
//   const baseMinForRewards = (await comet.baseMinForRewards()).toBigInt();
//   let expectedRewardsOwedWithoutMultiplier = 0n;
//   let expectedRewardsReceivedWithoutMultiplier = 0n;
//   if (totalSupplyPrincipal >= baseMinForRewards) {
//     expectedRewardsOwedWithoutMultiplier = calculateRewardsOwed(albertBalance, totalSupplyBalance, supplySpeed, timestampDelta, trackingIndexScale, rewardScale, rescaleFactorWithoutMultiplier.toBigInt());
//     expectedRewardsReceivedWithoutMultiplier = calculateRewardsOwed(albertBalance, totalSupplyBalance, supplySpeed, timestampDelta + timeElapsed, trackingIndexScale, rewardScale, rescaleFactorWithoutMultiplier.toBigInt());
//   }

//   // Occasionally `timestampDelta` is equal to 86401
//   expect(timestampDelta).to.be.greaterThanOrEqual(86400);
//   expect(newRewardsOwedBefore).to.be.equal(expectedRewardsOwedWithoutMultiplier * multiplier / exp(1, 18));
//   expect(await rewardToken.balanceOf(albert.address)).to.be.equal(expectedRewardsReceivedWithoutMultiplier * multiplier / exp(1, 18));
//   expect(newRewardsOwedAfter).to.be.equal(0n);

//   return txn; // return txn to measure gas
// }