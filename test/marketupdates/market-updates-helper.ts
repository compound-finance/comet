import {
  SimpleTimelock__factory,
  MarketUpdateTimelock__factory,
  MarketUpdateProposer__factory, MarketAdminPermissionChecker__factory,
} from './../../build/types';
import hre from 'hardhat';
import { ethers, expect } from './../helpers';

export async function makeMarketAdmin() {
  const {
    governorTimelockSigner: governorTimelockSigner,
  } = await initializeAndFundGovernorTimelock();

  const signers = await ethers.getSigners();

  const marketUpdateMultiSig = signers[10];
  const marketUpdateProposalGuardianSigner = signers[11];
  const marketAdminPauseGuardianSigner = signers[9];

  const marketAdminTimelockFactory = (await ethers.getContractFactory(
    'MarketUpdateTimelock'
  )) as MarketUpdateTimelock__factory;

  const marketUpdateTimelockContract = await marketAdminTimelockFactory.deploy(
    governorTimelockSigner.address,
    2 * 24 * 60 * 60 // This is 2 days in seconds
  );
  const marketUpdateTimelockAddress = await marketUpdateTimelockContract.deployed();

  // Impersonate the account
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [marketUpdateTimelockAddress.address],
  });

  // Fund the impersonated account
  await signers[0].sendTransaction({
    to: marketUpdateTimelockContract.address,
    value: ethers.utils.parseEther('1.0'), // Sending 1 Ether to cover gas fees
  });

  // Get the signer from the impersonated account
  const marketUpdateTimelockSigner = await ethers.getSigner(
    marketUpdateTimelockAddress.address
  );

  const marketUpdaterProposerFactory = (await ethers.getContractFactory(
    'MarketUpdateProposer'
  )) as MarketUpdateProposer__factory;

  // Fund the impersonated account
  await signers[0].sendTransaction({
    to: marketUpdateMultiSig.address,
    value: ethers.utils.parseEther('1.0'), // Sending 1 Ether to cover gas fees
  });

  // This sets the owner of the MarketUpdateProposer to the marketUpdateMultiSig
  const marketUpdateProposerContract = await marketUpdaterProposerFactory.deploy(
    governorTimelockSigner.address,
    marketUpdateMultiSig.address,
    marketUpdateProposalGuardianSigner.address,
    marketUpdateTimelockContract.address
  );

  expect(await marketUpdateProposerContract.governor()).to.be.equal(
    governorTimelockSigner.address
  );

  await marketUpdateTimelockContract
    .connect(governorTimelockSigner)
    .setMarketUpdateProposer(marketUpdateProposerContract.address);

  const MarketAdminPermissionCheckerFactory = (await ethers.getContractFactory(
    'MarketAdminPermissionChecker'
  )) as MarketAdminPermissionChecker__factory;


  const marketAdminPermissionCheckerContract =  await MarketAdminPermissionCheckerFactory.deploy(
    marketUpdateTimelockContract.address,
    marketAdminPauseGuardianSigner.address
  );
  await marketAdminPermissionCheckerContract.transferOwnership(governorTimelockSigner.address);

  await marketUpdateTimelockContract
    .connect(governorTimelockSigner)
    .setMarketUpdateProposer(marketUpdateProposerContract.address);

  return {
    marketUpdateProposerContract,
    marketAdminPermissionCheckerContract,
    marketUpdateTimelockContract,

    governorTimelockSigner, // used to impersonate the main governor timelock

    marketUpdateMultiSig, // used to impersonate the market update multisig
    marketAdminPauseGuardianSigner, // used to impersonate the market admin pause guardian
    marketUpdateProposalGuardianSigner, // used to impersonate the market update proposal guardian
    marketUpdateTimelockSigner, // used to impersonate the market update timelock
  };
}

export async function initializeAndFundGovernorTimelock() {
  const signers = await ethers.getSigners();
  const gov = signers[0];
  const TimelockFactory = (await ethers.getContractFactory(
    'SimpleTimelock'
  )) as SimpleTimelock__factory;
  const governorTimelock = await TimelockFactory.deploy(gov.address);
  await governorTimelock.deployed();

  // Impersonate the account
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [governorTimelock.address],
  });

  // Fund the impersonated account
  await gov.sendTransaction({
    to: governorTimelock.address,
    value: ethers.utils.parseEther('100.0'), // Sending 1 Ether to cover gas fees
  });

  // Get the signer from the impersonated account
  const governorTimelockSigner = await ethers.getSigner(governorTimelock.address);
  return { originalSigner: gov, governorTimelockSigner, governorTimelock };
}

export async function advanceTimeAndMineBlock(delay: number) {
  await ethers.provider.send('evm_increaseTime', [delay + 10]);
  await ethers.provider.send('evm_mine', []); // Mine a new block to apply the time increase
}


export async function createRandomWallet() {
  const signers = await ethers.getSigners();
  const gov = signers[0];
  const random = ethers.Wallet.createRandom({});
  random.connect(ethers.providers.getDefaultProvider());

  await gov.sendTransaction({
    to: random.address,
    value: ethers.utils.parseEther('100.0'), // Sending 1 Ether to cover gas fees
  });
  return random.connect(gov.provider);
}
