import { CometContext, CometProperties, scenario } from './context/CometContext';
import { expect } from 'chai';
import { ethers, exp, Numeric } from '../test/helpers';
import { isRewardsV2Supported, matchesDeployment } from './utils';
import { Contract, ContractReceipt, Signer } from 'ethers';
import { ERC20__factory } from '../build/types';
import { World } from '../plugins/scenario';
import { getLatestStartAndFinishMerkleTreeForCampaign } from '../scripts/rewards_v2/utils';
import { getConfigForScenario } from './utils/scenarioHelper';
import {
  CometRewardsV2,
  FaucetToken__factory,
} from '../build/types';
import { TokenMultiplierStruct } from '../build/types/CometRewardsV2';
import CometActor from './context/CometActor';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

function generateTree(accountsPrepared: [string, string][]) {
  // sort accounts by address (compare as bigints)
  accountsPrepared.sort((a, b) => {
    const addressA = BigInt(a[0]);
    const addressB = BigInt(b[0]);
    if (addressA < addressB) return -1;
    if (addressA > addressB) return 1;
    return 0;
  });
  // index all accounts
  let accountsIndexed: [string, string, string][] = [];
  for (let i = 0; i < accountsPrepared.length; i++) {
    accountsIndexed.push([accountsPrepared[i][0], i.toString(), accountsPrepared[i][1],]);
  }

  return StandardMerkleTree.of(accountsIndexed, ['address', 'uint256', 'uint256']);
}

function calculateRewardsOwedForNewMember(
  userBalance: bigint,
  totalBalance: bigint,
  speed: bigint,
  timeElapsed: number,
  trackingIndexScale: bigint,
  rewardTokenScale: bigint,
  rescaleFactor: bigint,
  startAccrued: bigint = 0n,
  finishAccrued: bigint = 0n,
  shouldUpscale = true
): bigint {
  // accrued = (user balance / total balance) * (speed / trackingIndexScale) * time * reward token scale
  const accrued = userBalance * speed * BigInt(timeElapsed) * rewardTokenScale / totalBalance / trackingIndexScale;

  // truncate using rescaleFactor
  if(finishAccrued > 0n) {
    return shouldUpscale?((finishAccrued - startAccrued) * rescaleFactor): ((accrued - startAccrued) / rescaleFactor * rescaleFactor);
  }
  if(startAccrued <= accrued)
    return shouldUpscale?((accrued - startAccrued)/ rescaleFactor * rescaleFactor) : (accrued - startAccrued) / rescaleFactor;
  else throw new Error('Error calculating rewards owed');
}

function calculateRewardsOwedForExistingMember(
  currentAccrued: bigint,
  rescaleFactor: bigint,
  startAccrued: bigint = 0n,
  finishAccrued: bigint = 0n,
  shouldUpscale = true
): bigint {
  // accrued = (user balance / total balance) * (speed / trackingIndexScale) * time * reward token scale
  const accrued = currentAccrued;

  // truncate using rescaleFactor
  if(finishAccrued > 0n) {
    return shouldUpscale?((finishAccrued - startAccrued) * rescaleFactor): ((accrued - startAccrued) / rescaleFactor * rescaleFactor);
  }
  if(startAccrued <= accrued)
    return shouldUpscale?((accrued - startAccrued)* rescaleFactor) : (accrued - startAccrued) / rescaleFactor * rescaleFactor;
  else throw new Error('Error calculating rewards owed');
}

export async function createNewCampaign(
  comet: Contract,
  rewardsV2: CometRewardsV2,
  admin: Signer,
  root: string,
  tokens: string[],
  duration: number,
  multipliers?: bigint[]
) : Promise<Numeric> {
  if(multipliers) {
    if(tokens.length !== multipliers.length) throw new Error('Arrays length mismatch');
    const assets: TokenMultiplierStruct[] = [];

    for (let i = 0; i < tokens.length; i++) {
      assets.push({ token: tokens[i], multiplier: multipliers[i].toString()});
    }

    const tx = await rewardsV2.connect(admin).setNewCampaignWithCustomTokenMultiplier(
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

export function getProof(address : string, tree: StandardMerkleTree<string[]>) {
  for (const [i, v] of tree.entries()) {
    if (v[0].toLowerCase() === address.toLowerCase()) {
      const proof = tree.getProof(i);
      return { proof, v };
    }
  }
  throw new Error('Address not found in tree');
}

function addressToBigInt(address: string): bigint {
  return BigInt(address.toLowerCase());
}

function getProofsForNewUser(address: string, tree: StandardMerkleTree<string[]>) {
  const targetAddressBigInt = addressToBigInt(address);
  let previousAddress = ethers.constants.AddressZero;
  let previousAddressBigInt = addressToBigInt(previousAddress);

  for (const [i, v] of tree.entries()) {
    const currentAddress = v[0].toLowerCase();
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
        accruedA: BigInt(tree.at(i - 1)[2]),
        accruedB: BigInt(tree.at(i)[2])
      };
    }

    // Update previous address for next iteration
    previousAddress = currentAddress;
    previousAddressBigInt = currentAddressBigInt;
  }
  throw new Error('No proof found');
}

// should find user who is NOT in start tree but is in finish tree
function findNewUserWithFinishTree(
  startTree: StandardMerkleTree<string[]>,
  finishTree: StandardMerkleTree<string[]>
) {
  for (const [i, v] of finishTree.entries()) {
    const address = v[0].toLowerCase();
    let found = false;
    for (const [, u] of startTree.entries()) {
      if (u[0].toLowerCase() === address.toLowerCase()) {
        found = true;
        break;
      }
    }
    if (!found && BigInt(v[2]) > 0n) {
      return { address, index: i, accrued: BigInt(v[2]) };
    }
  }
  throw new Error('No user found');
}

export async function getRewardsAdminSigner(
  ctx: CometContext
) : Promise<Signer> {
  const rewards = await ctx.world.deploymentManager.contract('rewardsV2');
  const adminAddress = await rewards.governor();
  // impersonate admin
  await ctx.world.deploymentManager.hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [adminAddress],
  });
  // set balance
  await ctx.world.deploymentManager.hre.ethers.provider.send('hardhat_setBalance', [
    adminAddress,
    ctx.world.deploymentManager.hre.ethers.utils.hexStripZeros(ctx.world.deploymentManager.hre.ethers.utils.parseUnits('100', 'ether').toHexString()),
  ]);
  return ctx.world.deploymentManager.getSigner(adminAddress);
}

scenario(
  'Comet#rewardsV2 > can claim supply rewards for self as existing user in new campaign with no finish tree',
  {
    filter: async (ctx) => await isRewardsV2Supported(ctx),
    tokenBalances: async (ctx: CometContext) => (
      {
        albert: { $base: ` == ${+getConfigForScenario(ctx).rewardsBase}`}, // in units of asset, not wei
        betty: { $base: ` == ${+getConfigForScenario(ctx).rewardsBase}`}, // in units of asset, not wei
      }
    ),
  },
  async ({ comet, rewardsV2, actors},  context, world) => {
    const { albert, betty } = actors;
    const deploymentManager = world.deploymentManager;
    const { startTree : startMerkleTree } = await getLatestStartAndFinishMerkleTreeForCampaign(
      deploymentManager.network,
      deploymentManager.deployment
    );
    const admin = await getRewardsAdminSigner(context);

    // impersonate someone from the tree with accrue > 1000
    let addressToImpersonate: string;
    let userIndex = 0;
    let accrued = 0n;
    for(let i = 0; i < startMerkleTree.length; i++) {
      const [address, index, accrue] = startMerkleTree.at(i);
      if(+accrue >= getConfigForScenario(context).minAccrue) {
        addressToImpersonate = address;
        accrued = BigInt(+accrue);
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
      rewardToken0: await FaucetTokenFactory.connect(admin).deploy(exp(10_000_000, 18), 'RewardToken0', 18, 'RewardToken0'),
      rewardToken1: await FaucetTokenFactory.connect(admin).deploy(exp(10_000_000, 6), 'RewardToken1', 6, 'RewardToken1')
    };
    const root = startMerkleTree.root;

    await rewardTokens.rewardToken0.connect(admin).transfer(rewardsV2.address, exp(10_000_000, 18));
    await rewardTokens.rewardToken1.connect(admin).transfer(rewardsV2.address, exp(10_000_000, 6));
  
    const newCampaignId = await createNewCampaign(
      comet,
      rewardsV2,
      admin,
      root,
      [rewardTokens.rewardToken0.address, rewardTokens.rewardToken1.address],
      90000 // 1 day + 1 hour
    );

    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const baseScale = (await comet.baseScale()).toBigInt();
    
    if((await comet.borrowBalanceOf(jay.address)).toBigInt() > 0n) {
      await betty.transferErc20(
        baseAssetAddress,
        jay.address,
        (await comet.borrowBalanceOf(jay.address)).toBigInt() + 50n
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

    await world.increaseTime(86400); 
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

    const rewardsBalanceBefore = [];
    rewardsBalanceBefore.push(await rewardTokens.rewardToken0.balanceOf(jay.address));
    rewardsBalanceBefore.push(await rewardTokens.rewardToken1.balanceOf(jay.address));

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
        startMerkleProof: getProof(jay.address, startMerkleTree).proof,
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

      if (totalSupplyPrincipal >= baseMinForRewards) {
        expectedRewardsOwed = calculateRewardsOwedForExistingMember(
          (await comet.baseTrackingAccrued(jay.address)).toBigInt(),
          configs[i].rescaleFactor.toBigInt(),
          accrued,
          0n,
          configs[i].shouldUpscale          
        );
        expectedRewardsReceived = rewardsBalanceBefore[i].toBigInt() + expectedRewardsOwed;
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

scenario(
  'Comet#rewardsV2 > can claim supply rewards for self as a new user in new campaign with no finish tree',
  {
    filter: async (ctx) => await isRewardsV2Supported(ctx),
    tokenBalances: async (ctx: CometContext) => (
      {
        albert: { $base: ` == ${+getConfigForScenario(ctx).rewardsBase * 2}`}, // in units of asset, not wei
      }
    ),
  },
  async ({ comet, rewardsV2, actors},  context, world) => {
    const { albert } = actors;
    const deploymentManager = world.deploymentManager;
    const { startTree : startMerkleTree } = await getLatestStartAndFinishMerkleTreeForCampaign(
      deploymentManager.network,
      deploymentManager.deployment
    );
    const admin = await getRewardsAdminSigner(context);

    const FaucetTokenFactory = (await deploymentManager.hre.ethers.getContractFactory('FaucetToken')) as FaucetToken__factory;
  
    const rewardTokens = {
      rewardToken0: await FaucetTokenFactory.deploy(exp(10_000_000, 18), 'RewardToken0', 18, 'RewardToken0'),
      rewardToken1: await FaucetTokenFactory.deploy(exp(10_000_000, 6), 'RewardToken1', 6, 'RewardToken1')
    };
    const root = startMerkleTree.root;

    await rewardTokens.rewardToken0.transfer(rewardsV2.address, exp(10_000_000, 18));
    await rewardTokens.rewardToken1.transfer(rewardsV2.address, exp(10_000_000, 6));

    const newCampaignId = await createNewCampaign(
      comet,
      rewardsV2,
      admin,
      root,
      [rewardTokens.rewardToken0.address, rewardTokens.rewardToken1.address],
      90000 // 1 day + 1 hour
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

    await world.increaseTime(86400); 
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
    const { proofA, proofB, indexA, indexB, addressA, addressB, accruedA, accruedB } = getProofsForNewUser(albert.address, startMerkleTree) || {};

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
        expectedRewardsOwed = calculateRewardsOwedForNewMember(
          albertBalance,
          totalSupplyBalance,
          supplySpeed,
          timestampDelta + 1,
          trackingIndexScale,
          rewardScale,
          configs[i].rescaleFactor.toBigInt()
        );
        expectedRewardsReceived = calculateRewardsOwedForNewMember(
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

scenario(
  'Comet#rewardsV2 > can claim supply rewards for self as existing user in new campaign with finish tree',
  {
    filter: async (ctx) => await isRewardsV2Supported(ctx),
  },
  async ({ comet, rewardsV2 },  context, world) => {
    const deploymentManager = world.deploymentManager;
    const { startTree : startMerkleTree, finishTree : finishMerkleTree } = await getLatestStartAndFinishMerkleTreeForCampaign(
      deploymentManager.network,
      deploymentManager.deployment
    );
    const admin = await getRewardsAdminSigner(context);

    let addressToImpersonate: string;
    let userIndexStart = 0;
    let accruedStart = 0n;

    let userIndexFinish = 0;
    let accruedFinish = 0n;
    for(let i = 0; i < startMerkleTree.length; i++) {
      const [_addressStart, _indexStart, _accrueStart] = startMerkleTree.at(i);

      addressToImpersonate = _addressStart;
      accruedStart = BigInt(+_accrueStart);
      userIndexStart = +_indexStart;

      for (const [, v] of finishMerkleTree.entries()) {
        if(
          v[0].toLowerCase() === _addressStart.toLowerCase()
          && BigInt(v[2]) > accruedStart
          && BigInt(v[2]) > BigInt(getConfigForScenario(context).minAccrue)
        ) {
          accruedFinish = BigInt(v[2]);
          userIndexFinish = +v[1];
          break;
        }
      }
      if(accruedFinish > 0n) break;
      if(i == startMerkleTree.length - 1) throw new Error('No user found');
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
      rewardToken0: await FaucetTokenFactory.connect(admin).deploy(exp(10_000_000, 18), 'RewardToken0', 18, 'RewardToken0'),
      rewardToken1: await FaucetTokenFactory.connect(admin).deploy(exp(10_000_000, 6), 'RewardToken1', 6, 'RewardToken1')
    };
    const root = startMerkleTree.root;

    await rewardTokens.rewardToken0.connect(admin).transfer(rewardsV2.address, exp(10_000_000, 18));
    await rewardTokens.rewardToken1.connect(admin).transfer(rewardsV2.address, exp(10_000_000, 6));

    const newCampaignId = await createNewCampaign(
      comet,
      rewardsV2,
      admin,
      root,
      [rewardTokens.rewardToken0.address, rewardTokens.rewardToken1.address],
      90000 // 1 day + 1 hour
    );

    const tokensAndConfig = await rewardsV2.rewardConfig(comet.address, newCampaignId);

    const tokens = tokensAndConfig[0];
    const configs = tokensAndConfig[1];

    const supplyTimestamp = await world.timestamp();
    await world.increaseTime(3600);
    await rewardsV2.connect(admin).setCampaignFinishRoot(comet.address, newCampaignId, finishMerkleTree.root);

    const preTxnTimestamp = await world.timestamp();

    await comet.connect(jay.signer).accrueAccount(jay.address);
    const rewardsOwedBefore = await rewardsV2.callStatic.getRewardsOwedBatch(
      comet.address,
      newCampaignId,
      jay.address,
      accruedStart,
      accruedFinish,
      false
    );

    const rewardsBalanceBefore = [];
    rewardsBalanceBefore.push(await rewardTokens.rewardToken0.balanceOf(jay.address));
    rewardsBalanceBefore.push(await rewardTokens.rewardToken1.balanceOf(jay.address));

    const txn = await (await rewardsV2.connect(jay.signer).claim(
      comet.address,
      newCampaignId,
      jay.address,
      false,
      {
        startIndex: userIndexStart,
        finishIndex: userIndexFinish,
        startAccrued: accruedStart.toString(),
        finishAccrued: accruedFinish.toString(),
        startMerkleProof: getProof(jay.address, startMerkleTree).proof,
        finishMerkleProof: getProof(jay.address, finishMerkleTree).proof
      }
    )).wait();
    const rewardsOwedAfter = await rewardsV2.callStatic.getRewardsOwedBatch(
      comet.address,
      newCampaignId,
      jay.address,
      accruedStart,
      accruedFinish,
      false
    );
    const timestampDelta = preTxnTimestamp - supplyTimestamp;
    let expectedRewardsOwed = 0n;
    let expectedRewardsReceived = 0n;

    for(let i = 0; i < tokens.length - 1; i++) {
      const rewardToken = new Contract(
        tokens[i],
        ERC20__factory.createInterface(),
        world.deploymentManager.hre.ethers.provider
      );

      expectedRewardsOwed = calculateRewardsOwedForExistingMember(
        (await comet.baseTrackingAccrued(jay.address)).toBigInt(),
        configs[i].rescaleFactor.toBigInt(),
        accruedStart,
        accruedFinish,
        configs[i].shouldUpscale          
      );
      expectedRewardsReceived = rewardsBalanceBefore[i].toBigInt() + expectedRewardsOwed;
      // Occasionally `timestampDelta` is equal to 3601
      expect(timestampDelta).to.be.greaterThanOrEqual(3600);
      expect(rewardsOwedBefore[i].owed.toBigInt()).to.be.equal(expectedRewardsOwed);
      expect(await rewardToken.balanceOf(jay.address)).to.be.equal(rewardsOwedBefore[i].owed);
      expect(await rewardToken.balanceOf(jay.address)).to.be.equal(expectedRewardsReceived);
      expect(rewardsOwedAfter[i].owed.toBigInt()).to.be.equal(0n);
    }
    return txn; // return txn to measure gas
  });

scenario(
  'Comet#rewardsV2 > can claim supply rewards for self as a new user in new campaign with finish tree',
  {
    filter: async (ctx) => await isRewardsV2Supported(ctx),
  }, 
  async ({ comet, rewardsV2 },  context, world) => {
    const deploymentManager = world.deploymentManager;
    const { startTree : startMerkleTree, finishTree : finishMerkleTree } = await getLatestStartAndFinishMerkleTreeForCampaign(
      deploymentManager.network,
      deploymentManager.deployment
    );
    const admin = await getRewardsAdminSigner(context);

    const FaucetTokenFactory = (await deploymentManager.hre.ethers.getContractFactory('FaucetToken')) as FaucetToken__factory;
    let addressToImpersonate: string, userIndex: number, accruedFinish: bigint, newStartMerkleTree: StandardMerkleTree<string[]>;
    try{
      const { address, index, accrued } = findNewUserWithFinishTree(startMerkleTree, finishMerkleTree);
      addressToImpersonate = address;
      userIndex = index;
      accruedFinish = accrued;
    }
    catch(e) {
      if(e.message === 'No user found') {
        // create new tree without the user
        for(let i = 0; i < startMerkleTree.length; i++) {
          const [address, index, accrue] = finishMerkleTree.at(i);
          if(+accrue >= getConfigForScenario(context).minAccrue) {
            addressToImpersonate = address;
            accruedFinish = BigInt(+accrue);
            userIndex = +index;
            break;
          }
        }

        const accountsPrepared: [string, string][] = [];

        for (const [, v] of startMerkleTree.entries()) {
          if(v[0].toLowerCase() !== addressToImpersonate.toLowerCase()) {
            accountsPrepared.push([v[0].toLowerCase(), v[2]]);
          }
        }
        newStartMerkleTree = generateTree(accountsPrepared);
      }
      else throw e;
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

    const rewardTokens = {
      rewardToken0: await FaucetTokenFactory.deploy(exp(10_000_000, 18), 'RewardToken0', 18, 'RewardToken0'),
      rewardToken1: await FaucetTokenFactory.deploy(exp(10_000_000, 6), 'RewardToken1', 6, 'RewardToken1')
    };
    const root = newStartMerkleTree? newStartMerkleTree.root : startMerkleTree.root;

    await rewardTokens.rewardToken0.transfer(rewardsV2.address, exp(10_000_000, 18));
    await rewardTokens.rewardToken1.transfer(rewardsV2.address, exp(10_000_000, 6));

    const newCampaignId = await createNewCampaign(
      comet,
      rewardsV2,
      admin,
      root,
      [rewardTokens.rewardToken0.address, rewardTokens.rewardToken1.address],
      90000 // 1 day + 1 hour
    );

    const tokensAndConfig = await rewardsV2.rewardConfig(comet.address, newCampaignId);

    const tokens = tokensAndConfig[0];
    const configs = tokensAndConfig[1];

    
    const supplyTimestamp = await world.timestamp();
    const jayBalance = await jay.getCometBaseBalance();
    const totalSupplyBalance = (await comet.totalSupply()).toBigInt();
    await world.increaseTime(3600); 
    await rewardsV2.connect(admin).setCampaignFinishRoot(comet.address, newCampaignId, finishMerkleTree.root);

    const preTxnTimestamp = await world.timestamp();

    await comet.connect(jay.signer).accrueAccount(jay.address);
    const rewardsOwedBefore = await rewardsV2.callStatic.getRewardsOwedBatch(
      comet.address,
      newCampaignId,
      jay.address,
      0,
      accruedFinish,
      false
    );   
    const {
      proofA,
      proofB,
      indexA,
      indexB,
      addressA,
      addressB,
      accruedA,
      accruedB
    } = getProofsForNewUser(jay.address, newStartMerkleTree? newStartMerkleTree : startMerkleTree) || {};

    const finishProofDataA = getProof(addressA, finishMerkleTree);
    const finishProofDataB = getProof(addressB, finishMerkleTree);

    const finishIndexA = +finishProofDataA.v[1];
    const finishIndexB = +finishProofDataB.v[1];

    const finishProofA = finishProofDataA.proof;
    const finishProofB = finishProofDataB.proof;

    const finishAccruedA = BigInt(finishProofDataA.v[2]);
    const finishAccruedB = BigInt(finishProofDataB.v[2]);

    const txn = await (await rewardsV2.connect(jay.signer).claimForNewMember(
      comet.address,
      newCampaignId,
      jay.address,
      false,
      [addressA, addressB],
      [
        {
          startIndex: indexA,
          finishIndex: finishIndexA,
          startAccrued: accruedA,
          finishAccrued: finishAccruedA,
          startMerkleProof: proofA,
          finishMerkleProof: finishProofA
        },
        {
          startIndex: indexB,
          finishIndex: finishIndexB,
          startAccrued: accruedB,
          finishAccrued: finishAccruedB,
          startMerkleProof: proofB,
          finishMerkleProof: finishProofB
        }
      ],
      {
        finishIndex: userIndex,
        finishAccrued: accruedFinish,
        finishMerkleProof: getProof(jay.address, finishMerkleTree).proof
      }
    )).wait();
    const rewardsOwedAfter = await rewardsV2.callStatic.getRewardsOwedBatch(
      comet.address,
      newCampaignId,
      jay.address,
      0,
      accruedFinish,
      false
    );
    const postTxnTimestamp = await world.timestamp();
    const timeElapsed = postTxnTimestamp - preTxnTimestamp;
    const supplySpeed = (await comet.baseTrackingSupplySpeed()).toBigInt();
    const trackingIndexScale = (await comet.trackingIndexScale()).toBigInt();
    const timestampDelta = preTxnTimestamp - supplyTimestamp;
    let expectedRewardsOwed = 0n;
    let expectedRewardsReceived = 0n;

    for(let i = 0; i < tokens.length - 1; i++) {
      const rewardToken = new Contract(
        tokens[i],
        ERC20__factory.createInterface(),
        world.deploymentManager.hre.ethers.provider
      );
      const rewardScale = exp(1, await rewardToken.decimals());

      expectedRewardsOwed = calculateRewardsOwedForNewMember(
        jayBalance,
        totalSupplyBalance,
        supplySpeed,
        timestampDelta + 1,
        trackingIndexScale,
        rewardScale,
        configs[i].rescaleFactor.toBigInt(),
        BigInt(0),
        accruedFinish
      );
      expectedRewardsReceived = calculateRewardsOwedForNewMember(
        jayBalance,
        totalSupplyBalance,
        supplySpeed,
        timestampDelta + timeElapsed - 1,
        trackingIndexScale,
        rewardScale,
        configs[i].rescaleFactor.toBigInt(),
        BigInt(0),
        accruedFinish
      );

      // Occasionally `timestampDelta` is equal to 3601
      expect(timestampDelta).to.be.greaterThanOrEqual(3601);
      expect(rewardsOwedBefore[i].owed.toBigInt()).to.be.equal(expectedRewardsOwed);
      expect(await rewardToken.balanceOf(jay.address)).to.be.equal(rewardsOwedBefore[i].owed);
      expect(await rewardToken.balanceOf(jay.address)).to.be.equal(expectedRewardsReceived);
      expect(rewardsOwedAfter[i].owed.toBigInt()).to.be.equal(0n);
    }
    return txn; // return txn to measure gas
  });

scenario(
  'Comet#rewardsV2 > manager can claimTo for an existing user supply rewards from a managed account',
  {
    filter: async (ctx) => await isRewardsV2Supported(ctx) && !matchesDeployment(ctx, [{network: 'mainnet', deployment: 'weth'}]),
    tokenBalances: async (ctx: CometContext) => (
      {
        albert: { $base: ` == ${+getConfigForScenario(ctx).rewardsBase}` }, // in units of asset, not wei
      }
    ),
  },
  async ({ comet, rewardsV2, actors }, context, world) => {
    const { betty } = actors;
    
    const deploymentManager = world.deploymentManager;
    const { startTree : startMerkleTree } = await getLatestStartAndFinishMerkleTreeForCampaign(
      deploymentManager.network,
      deploymentManager.deployment
    );
    const admin = await getRewardsAdminSigner(context);

    // impersonate someone from the tree with accrue > 1000
    let addressToImpersonate: string;
    let userIndex = 0;
    let accrued = 0n;
    for(let i = 0; i < startMerkleTree.length; i++) {
      const [address, index, accrue] = startMerkleTree.at(i);
      if(+accrue >= getConfigForScenario(context).minAccrue) {
        const supplyBalance = await comet.balanceOf(address);
        const borrowBalanceOf = await comet.borrowBalanceOf(address);
        if(borrowBalanceOf.eq(0) && supplyBalance.gt(0)) {
          addressToImpersonate = address;
          accrued = BigInt(+accrue);
          userIndex = +index;
          break;
        }
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
    await comet.connect(jay.signer).allow(betty.address, true);

    const FaucetTokenFactory = (await deploymentManager.hre.ethers.getContractFactory('FaucetToken')) as FaucetToken__factory;
    const rewardTokens = {
      rewardToken0: await FaucetTokenFactory.deploy(exp(10_000_000, 18), 'RewardToken0', 18, 'RewardToken0'),
      rewardToken1: await FaucetTokenFactory.deploy(exp(10_000_000, 6), 'RewardToken1', 6, 'RewardToken1')
    };
    const root = startMerkleTree.root;
  
    await rewardTokens.rewardToken0.transfer(rewardsV2.address, exp(10_000_000, 18));
    await rewardTokens.rewardToken1.transfer(rewardsV2.address, exp(10_000_000, 6));

    const newCampaignId = await createNewCampaign(
      comet,
      rewardsV2,
      admin,
      root,
      [rewardTokens.rewardToken0.address, rewardTokens.rewardToken1.address],
      90000 // 1 day + 1 hour
    );

    const tokensAndConfig = await rewardsV2.rewardConfig(comet.address, newCampaignId);

    const tokens = tokensAndConfig[0];
    const configs = tokensAndConfig[1];

    const supplyTimestamp = await world.timestamp();

    await world.increaseTime(3600); // fast forward a hour

    const preTxnTimestamp = await world.timestamp();

    await comet.connect(jay.signer).accrueAccount(jay.address);

    const rewardsOwedBefore = await rewardsV2.callStatic.getRewardsOwedBatch(
      comet.address,
      newCampaignId,
      jay.address,
      accrued,
      0,
      false
    );

    const rewardsBalanceBefore = [];
    rewardsBalanceBefore.push(await rewardTokens.rewardToken0.balanceOf(jay.address));
    rewardsBalanceBefore.push(await rewardTokens.rewardToken1.balanceOf(jay.address));

    const txn = await (await rewardsV2.connect(betty.signer).claimTo(
      comet.address,
      newCampaignId,
      jay.address,
      jay.address,
      false,
      {
        startIndex: userIndex,
        finishIndex: 0,
        startAccrued: accrued.toString(),
        finishAccrued: 0n,
        startMerkleProof: getProof(jay.address, startMerkleTree).proof,
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
      // const rewardScale = exp(1, await rewardToken.decimals());

      if (totalSupplyPrincipal >= baseMinForRewards) {
        expectedRewardsOwed = calculateRewardsOwedForExistingMember(
          (await comet.baseTrackingAccrued(jay.address)).toBigInt(),
          configs[i].rescaleFactor.toBigInt(),
          accrued,
          0n,
          configs[i].shouldUpscale          
        );
        expectedRewardsReceived = rewardsBalanceBefore[i].toBigInt() + expectedRewardsOwed;
      }

      // Occasionally `timestampDelta` is equal to 3601
      expect(timestampDelta).to.be.greaterThanOrEqual(3600);
      expect(rewardsOwedBefore[i].owed.toBigInt()).to.be.equal(expectedRewardsOwed);
      expect(await rewardToken.balanceOf(jay.address)).to.be.equal(rewardsOwedBefore[i].owed);
      expect(await rewardToken.balanceOf(jay.address)).to.be.equal(expectedRewardsReceived);
      expect(rewardsOwedAfter[i].owed.toBigInt()).to.be.equal(0n);
    }
    return txn; // return txn to measure gas
  });

scenario(
  'Comet#rewardsV2 > can claim borrow rewards for self as a new user in new campaign with no finish tree',
  {
    filter: async (ctx) => await isRewardsV2Supported(ctx),
    tokenBalances: async (ctx: CometContext) => (
      {
        albert: { $asset0: ` == ${+getConfigForScenario(ctx).rewardsBase}` }, // in units of asset, not wei
        $comet: { $base: ` >= ${+getConfigForScenario(ctx).rewardsBase * 100}` }
      }
    ),
  },
  async ({ comet, rewardsV2, actors }, context, world) => {
    const { albert } = actors;
    const deploymentManager = world.deploymentManager;
    const { startTree : startMerkleTree } = await getLatestStartAndFinishMerkleTreeForCampaign(
      deploymentManager.network,
      deploymentManager.deployment
    );
    const admin = await getRewardsAdminSigner(context);

    const FaucetTokenFactory = (await deploymentManager.hre.ethers.getContractFactory('FaucetToken')) as FaucetToken__factory;
  
    const rewardTokens = {
      rewardToken0: await FaucetTokenFactory.connect(admin).deploy(exp(10_000_000, 18), 'RewardToken0', 18, 'RewardToken0'),
      rewardToken1: await FaucetTokenFactory.connect(admin).deploy(exp(10_000_000, 6), 'RewardToken1', 6, 'RewardToken1')
    };
    const root = startMerkleTree.root;

    await rewardTokens.rewardToken0.connect(admin).transfer(rewardsV2.address, exp(10_000_000, 18));
    await rewardTokens.rewardToken1.connect(admin).transfer(rewardsV2.address, exp(10_000_000, 6));

    const newCampaignId = await createNewCampaign(
      comet,
      rewardsV2,
      admin,
      root,
      [rewardTokens.rewardToken0.address, rewardTokens.rewardToken1.address],
      90000 // 1 day + 1 hour
    );

    const baseAssetAddress = await comet.baseToken();
    const baseScale = (await comet.baseScale()).toBigInt();
    const { asset: collateralAssetAddress, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(collateralAssetAddress);
    const scale = scaleBN.toBigInt();
    const toSupply = BigInt(getConfigForScenario(context).rewardsBase) * scale;
    const toBorrow = BigInt(getConfigForScenario(context).rewardsBase) / 10n  * baseScale;

    await collateralAsset.approve(albert, comet.address);
    await albert.safeSupplyAsset({ asset: collateralAssetAddress, amount: toSupply });
    await albert.withdrawAsset({ asset: baseAssetAddress, amount: toBorrow });

    expect(await rewardTokens.rewardToken0.balanceOf(albert.address)).to.be.equal(0n);
    expect(await rewardTokens.rewardToken1.balanceOf(albert.address)).to.be.equal(0n);

    const tokensAndConfig = await rewardsV2.rewardConfig(comet.address, newCampaignId);
    const tokens = tokensAndConfig[0];
    const configs = tokensAndConfig[1];

    const supplyTimestamp = await world.timestamp();
    const albertBalance = await albert.getCometBaseBalance();
    const totalBorrowBalance = (await comet.totalBorrow()).toBigInt();
    
    await world.increaseTime(86400); 
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
    const { proofA, proofB, indexA, indexB, addressA, addressB, accruedA, accruedB } = getProofsForNewUser(albert.address, startMerkleTree) || {};

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
    const borrowSpeed = (await comet.baseTrackingBorrowSpeed()).toBigInt();
    const trackingIndexScale = (await comet.trackingIndexScale()).toBigInt();
    const timestampDelta = preTxnTimestamp - supplyTimestamp;
    const totalBorrowPrincipal = (await comet.totalsBasic()).totalBorrowBase.toBigInt();
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

      if (totalBorrowPrincipal >= baseMinForRewards) {
        expectedRewardsOwed = calculateRewardsOwedForNewMember(
          -albertBalance,
          totalBorrowBalance,
          borrowSpeed,
          timestampDelta + 1,
          trackingIndexScale,
          rewardScale,
          configs[i].rescaleFactor.toBigInt()
        );
        expectedRewardsReceived = calculateRewardsOwedForNewMember(
          -albertBalance,
          totalBorrowBalance,
          borrowSpeed,
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

scenario(
  'Comet#rewardsV2 > cannot claim rewards with invalid merkle proof',
  {
    filter: async (ctx) => await isRewardsV2Supported(ctx),
  },
  async ({ comet, rewardsV2 }, context, world) => {
    const deploymentManager = world.deploymentManager;
    const { startTree : startMerkleTree } = await getLatestStartAndFinishMerkleTreeForCampaign(
      deploymentManager.network,
      deploymentManager.deployment
    );
    const admin = await getRewardsAdminSigner(context);

    // impersonate someone from the tree with accrue > 1000
    let addressToImpersonate: string;
    let accrued = 0n;
    for(let i = 0; i < startMerkleTree.length; i++) {
      const [address, , accrue] = startMerkleTree.at(i);
      if(+accrue >= getConfigForScenario(context).minAccrue) {
        addressToImpersonate = address;
        accrued = BigInt(+accrue);
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
      rewardToken0: await FaucetTokenFactory.connect(admin).deploy(exp(10_000_000, 18), 'RewardToken0', 18, 'RewardToken0'),
      rewardToken1: await FaucetTokenFactory.connect(admin).deploy(exp(10_000_000, 6), 'RewardToken1', 6, 'RewardToken1')
    };
    const root = startMerkleTree.root;
    console.log(root);
    console.log(jay.address);

    await(
      await rewardTokens.rewardToken0.connect(admin).transfer(rewardsV2.address, exp(10_000_000, 18))
    ).wait();
    await(
      await rewardTokens.rewardToken1.connect(admin).transfer(rewardsV2.address, exp(10_000_000, 6))
    ).wait();
  
    const newCampaignId = await createNewCampaign(
      comet,
      rewardsV2,
      admin,
      root,
      [rewardTokens.rewardToken0.address, rewardTokens.rewardToken1.address],
      90000 // 1 day + 1 hour
    );

    await world.increaseTime(
      (await rewardsV2.campaigns(comet.address, newCampaignId)).finishTimestamp.sub(
        await world.timestamp()
      ).toNumber()
    );

    await(await comet.accrueAccount(jay.address)).wait();
    await expect(rewardsV2.claim(
      comet.address,
      newCampaignId,
      jay.address,
      false,
      {
        startIndex: 0,
        finishIndex: 0,
        startAccrued: accrued.toString(),
        finishAccrued: 0n,
        startMerkleProof: getProof(jay.address, startMerkleTree).proof,
        finishMerkleProof: []
      }
    )).to.be.revertedWithCustomError(rewardsV2, 'InvalidProof');
  });


const MULTIPLIERS = [
  exp(55, 18),
  exp(10, 18),
  exp(1, 18),
  exp(0.01, 18),
  exp(0.00355, 18)
];

for (let i = 0; i < MULTIPLIERS.length; i++) {
  scenario(
    `Comet#rewardsV2 > can claim supply rewards as existing user on scaling rewards contract with multiplier of ${MULTIPLIERS[i]}`,
    {
      filter: async (ctx) => await isRewardsV2Supported(ctx),
      tokenBalances: async (ctx: CometContext) => (
        {
          albert: { $base: ` == ${+getConfigForScenario(ctx).rewardsBase}` }, // in units of asset, not wei
          betty: { $base: ` == ${+getConfigForScenario(ctx).rewardsBase}` }, // in units of asset, not wei
        }
      ),
    },
    async (properties, context, world) => {
      const rewardsV2 = properties.rewardsV2;
      return await testScalingRewardV2ForExistingUser(properties, rewardsV2, context, world, MULTIPLIERS[i]);
    }
  );
}

async function testScalingRewardV2ForExistingUser(properties: CometProperties, rewardsV2: CometRewardsV2, context: CometContext, world: World, multiplier: bigint): Promise<void | ContractReceipt> {
  const { comet, actors } = properties;
  const { albert, betty } = actors;
  const deploymentManager = world.deploymentManager;
  const { startTree : startMerkleTree } = await getLatestStartAndFinishMerkleTreeForCampaign(
    deploymentManager.network,
    deploymentManager.deployment
  );
  const admin = await getRewardsAdminSigner(context);

  // impersonate someone from the tree with accrue > 1000
  let addressToImpersonate: string;
  let userIndex = 0;
  let accrued = 0n;
  for(let i = 0; i < startMerkleTree.length; i++) {
    const [address, index, accrue] = startMerkleTree.at(i);
    if(+accrue >= getConfigForScenario(context).minAccrue) {
      addressToImpersonate = address;
      accrued = BigInt(+accrue);
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
    rewardToken0: await FaucetTokenFactory.connect(admin).deploy(exp(10_000_000, 18), 'RewardToken0', 18, 'RewardToken0'),
    rewardToken1: await FaucetTokenFactory.connect(admin).deploy(exp(10_000_000, 6), 'RewardToken1', 6, 'RewardToken1')
  };
  const root = startMerkleTree.root;
  await rewardTokens.rewardToken0.deployed();
  await rewardTokens.rewardToken1.deployed();

  // mine 1 block
  await world.increaseTime(1);
  await(
    await rewardTokens.rewardToken0.connect(admin).transfer(rewardsV2.address, exp(10_000_000, 18))
  ).wait();
  await(
    await rewardTokens.rewardToken1.connect(admin).transfer(rewardsV2.address, exp(10_000_000, 6))
  ).wait();
  const newCampaignId = await createNewCampaign(
    comet,
    rewardsV2,
    admin,
    root,
    [rewardTokens.rewardToken0.address, rewardTokens.rewardToken1.address],
    90000, // 1 day + 1 hour
    [multiplier, multiplier]
  );

  const baseAssetAddress = await comet.baseToken();
  const baseAsset = context.getAssetByAddress(baseAssetAddress);
  const baseScale = (await comet.baseScale()).toBigInt();
 
  if((await comet.borrowBalanceOf(jay.address)).toBigInt() > 0n) {
    await betty.transferErc20(
      baseAssetAddress,
      jay.address,
      (await comet.borrowBalanceOf(jay.address)).toBigInt() + 50n
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

  await world.increaseTime(86400); 
  const preTxnTimestamp = await world.timestamp();

  await (await comet.connect(albert.signer).accrueAccount(jay.address)).wait();
  const rewardsOwedBefore = await rewardsV2.callStatic.getRewardsOwedBatch(
    comet.address,
    newCampaignId,
    jay.address,
    accrued,
    0,
    false
  );

  const rewardsBalanceBefore = [];
  rewardsBalanceBefore.push(await rewardTokens.rewardToken0.balanceOf(jay.address));
  rewardsBalanceBefore.push(await rewardTokens.rewardToken1.balanceOf(jay.address));

  const txn = await (await rewardsV2.claim(
    comet.address,
    newCampaignId,
    jay.address,
    false,
    {
      startIndex: userIndex,
      finishIndex: 0,
      startAccrued: accrued,
      finishAccrued: 0,
      startMerkleProof: getProof(jay.address, startMerkleTree).proof,
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

  const timestampDelta = preTxnTimestamp - supplyTimestamp;
  let expectedRewardsOwedWithoutMultiplier = 0n;
  let expectedRewardsReceivedWithoutMultiplier = 0n;

  for(let i = 0; i < tokens.length - 1; i++) {
    const rewardToken = new Contract(
      tokens[i],
      ERC20__factory.createInterface(),
      world.deploymentManager.hre.ethers.provider
    );

    expectedRewardsOwedWithoutMultiplier = calculateRewardsOwedForExistingMember(
      (await comet.baseTrackingAccrued(jay.address)).toBigInt(),
      configs[i].rescaleFactor.toBigInt(),
      accrued,
      0n,
      configs[i].shouldUpscale          
    );
    expectedRewardsReceivedWithoutMultiplier = rewardsBalanceBefore[i].toBigInt() + expectedRewardsOwedWithoutMultiplier;

    // Occasionally `timestampDelta` is equal to 86401
    expect(timestampDelta).to.be.greaterThanOrEqual(86400);
    expect(rewardsOwedBefore[i].owed.toBigInt()).to.be.equal(expectedRewardsOwedWithoutMultiplier * multiplier / exp(1, 18));
    expect(await rewardToken.balanceOf(jay.address)).to.be.equal(rewardsOwedBefore[i].owed);
    expect(await rewardToken.balanceOf(jay.address)).to.be.equal(expectedRewardsReceivedWithoutMultiplier * multiplier / exp(1, 18));
    expect(rewardsOwedAfter[i].owed.toBigInt()).to.be.equal(0n);
  }
  return txn; // return txn to measure gas
}
