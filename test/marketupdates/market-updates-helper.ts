import {
  SimpleTimelock__factory,
  MarketUpdateTimelock__factory,
  MarketUpdateProposer__factory,
} from './../../build/types';
import hre from 'hardhat';
import { ethers, expect } from './../helpers';

export async function makeMarketAdmin() {
  const {
    governorTimelockSigner: governorTimelockSigner,
  } = await initializeAndFundGovernorTimelock();

  const signers = await ethers.getSigners();

  const marketUpdateMultiSig = signers[10];
  const pauseGuardianSigner = signers[11];
  
  const marketAdminTimelockFactory = (await ethers.getContractFactory(
    'MarketUpdateTimelock'
  )) as MarketUpdateTimelock__factory;

  const marketUpdateTimelock = await marketAdminTimelockFactory.deploy(
    governorTimelockSigner.address,
    2 * 24 * 60 * 60 // This is 2 days in seconds
  );
  const marketUpdateTimelockAddress = await marketUpdateTimelock.deployed();

  // Impersonate the account
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [marketUpdateTimelockAddress.address],
  });

  // Fund the impersonated account
  await signers[0].sendTransaction({
    to: marketUpdateTimelock.address,
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
  const marketUpdateProposer = await marketUpdaterProposerFactory
    .deploy(governorTimelockSigner.address, marketUpdateMultiSig.address, pauseGuardianSigner.address, marketUpdateTimelock.address);

  expect(await marketUpdateProposer.governor()).to.be.equal(
    governorTimelockSigner.address
  );

  await marketUpdateTimelock
    .connect(governorTimelockSigner)
    .setMarketUpdateProposer(marketUpdateProposer.address);

  return {
    governorTimelockSigner,
    marketUpdateMultiSig,
    pauseGuardianSigner,
    marketUpdateTimelock,
    marketUpdateTimelockSigner,
    marketUpdateProposer,
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
