import { makeMarketAdmin, advanceTimeAndMineBlock } from './market-updates-helper';
import { expect, makeConfigurator, ethers, wait, event } from '../helpers';
import { MarketAdminPermissionChecker__factory, MarketUpdateProposer__factory } from '../../build/types';

describe('MarketUpdateProposer', function() {
  // We are not checking market updates here. we are just checking interaction
  // between MarketUpdateMultisig and MarketUpdateProposer or checking interactions
  // on MarketUpdateProposer
  it('is initialized properly with timelock', async () => {
    const {
      marketUpdateProposerContract,
      marketUpdateTimelockContract,
    } = await makeMarketAdmin();

    expect(await marketUpdateProposerContract.timelock()).to.equal(
      marketUpdateTimelockContract.address
    );
  });

  it('MarketUpdateMultisig is set as the marketAdmin of MarketUpdateProposer', async () => {
    const {
      marketUpdateProposerContract,
      marketUpdateMultiSig,
    } = await makeMarketAdmin();

    expect(await marketUpdateProposerContract.marketAdmin()).to.equal(
      marketUpdateMultiSig.address
    );
  });

  it('only GovernorTimelock can set a new governor for MarketUpdateProposer', async () => {
    const {
      governorTimelockSigner,
      marketUpdateProposerContract,
    } = await makeMarketAdmin();

    const {
      users: [alice, bob],
    } = await makeConfigurator();

    expect(await marketUpdateProposerContract.governor()).to.equal(
      governorTimelockSigner.address
    );

    await marketUpdateProposerContract
      .connect(governorTimelockSigner)
      .setGovernor(alice.address);

    expect(await marketUpdateProposerContract.governor()).to.equal(alice.address);
    
    await expect(
      marketUpdateProposerContract.connect(bob).setGovernor(alice.address)
    ).to.be.revertedWithCustomError(marketUpdateProposerContract, 'Unauthorized');
  });
  
  it('only GovernorTimelock can set a new proposalGuardian for MarketUpdateProposer', async () => {
    const {
      governorTimelockSigner,
      marketUpdateProposerContract,
    } = await makeMarketAdmin();

    const {
      users: [alice, bob],
    } = await makeConfigurator();

    expect(await marketUpdateProposerContract.governor()).to.equal(
      governorTimelockSigner.address
    );

    await marketUpdateProposerContract
      .connect(governorTimelockSigner)
      .setProposalGuardian(alice.address);

    expect(await marketUpdateProposerContract.proposalGuardian()).to.equal(alice.address);
    
    await expect(
      marketUpdateProposerContract.connect(bob).setProposalGuardian(alice.address)
    ).to.be.revertedWithCustomError(marketUpdateProposerContract, 'Unauthorized');
  });
  
  it('only allows MarketUpdateMultisig to create proposal', async () => {
    const {
      marketUpdateProposerContract,
      marketUpdateMultiSig,
    } = await makeMarketAdmin();

    const {
      configuratorProxy,
      cometProxy,
      users: [alice],
    } = await makeConfigurator();

    let setSupplyKinkCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'uint64'],
      [cometProxy.address, 100]
    );

    const proposalId = 1n;
    const proposalDescription = 'Test Proposal';

    // Creates a proposal successfully as the signer is the multisig
    const txn = await wait(
      marketUpdateProposerContract
        .connect(marketUpdateMultiSig)
        .propose(
          [configuratorProxy.address],
          [0],
          ['setSupplyKink(address,uint64)'],
          [setSupplyKinkCalldata],
          'Test Proposal'
        )
    );

    // Checks the emitter event properly
    expect(event(txn, 0)).to.be.deep.equal({
      MarketUpdateProposalCreated: {
        id: proposalId,
        proposer: marketUpdateMultiSig.address,
        targets: [configuratorProxy.address],
        signatures: ['setSupplyKink(address,uint64)'],
        calldatas: [setSupplyKinkCalldata],
        description: proposalDescription,
      },
    });

    // this will fail because the signer is not the multisig
    await expect(
      marketUpdateProposerContract
        .connect(alice)
        .propose(
          [configuratorProxy.address],
          [0],
          ['setSupplyKink(address,uint64)'],
          [setSupplyKinkCalldata],
          proposalDescription
        )
    ).to.be.revertedWithCustomError(marketUpdateProposerContract,'Unauthorized');
  });

  it('keeps track of all the proposals', async () => {
    const {
      marketUpdateProposerContract,
      marketUpdateMultiSig,
    } = await makeMarketAdmin();

    const { configuratorProxy, cometProxy } = await makeConfigurator();

    let setSupplyKinkCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'uint64'],
      [cometProxy.address, 100]
    );

    const proposalId = 1n;
    const proposalDescription = 'Test Proposal';

    // Creates a proposal successfully as the signer is the multisig
    await marketUpdateProposerContract
      .connect(marketUpdateMultiSig)
      .propose(
        [configuratorProxy.address],
        [0],
        ['setSupplyKink(address,uint64)'],
        [setSupplyKinkCalldata],
        proposalDescription
      );

    // Checks the proposal
    const proposal = await marketUpdateProposerContract.getProposal(proposalId);

    expect(proposal[0]).to.equal(proposalId);
    expect(proposal[1]).to.equal(marketUpdateMultiSig.address);
    expect(proposal[3][0]).to.equal(configuratorProxy.address);
    expect(proposal[5][0]).to.equal('setSupplyKink(address,uint64)');
    expect(proposal[6][0]).to.equal(setSupplyKinkCalldata);
  });

  it('can cancel the proposal', async () => {
    // Create a proposal
    // Cancel the proposal
    // Check if the proposal is cancelled
    const {
      marketUpdateProposerContract,
      marketUpdateMultiSig,
    } = await makeMarketAdmin();

    const { configuratorProxy, cometProxy } = await makeConfigurator();

    let setSupplyKinkCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'uint64'],
      [cometProxy.address, 100]
    );

    const proposalId = 1n;
    const proposalDescription = 'Test Proposal';

    // Creates a proposal successfully as the signer is the multisig
    await marketUpdateProposerContract
      .connect(marketUpdateMultiSig)
      .propose(
        [configuratorProxy.address],
        [0],
        ['setSupplyKink(address,uint64)'],
        [setSupplyKinkCalldata],
        proposalDescription
      );

    expect(
      (await marketUpdateProposerContract.proposals(proposalId)).canceled
    ).to.be.equal(false);

    // Cancel the proposal
    await marketUpdateProposerContract.connect(marketUpdateMultiSig).cancel(proposalId);

    expect(
      (await marketUpdateProposerContract.proposals(proposalId)).canceled
    ).to.be.equal(true);

    await expect(
      marketUpdateProposerContract.connect(marketUpdateMultiSig).execute(proposalId)
    ).to.be.revertedWith(
      'MarketUpdateProposer::execute: proposal can only be executed if it is queued'
    );
  });

  it('marks the proposal as expired after grace period', async () => {
    const {
      marketUpdateProposerContract,
      marketUpdateMultiSig,
    } = await makeMarketAdmin();

    const { configuratorProxy, cometProxy } = await makeConfigurator();

    let setSupplyKinkCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'uint64'],
      [cometProxy.address, 100]
    );

    const proposalId = 1n;
    const proposalDescription = 'Test Proposal';

    // Creates a proposal successfully as the signer is the multisig
    await marketUpdateProposerContract
      .connect(marketUpdateMultiSig)
      .propose(
        [configuratorProxy.address],
        [0],
        ['setSupplyKink(address,uint64)'],
        [setSupplyKinkCalldata],
        proposalDescription
      );

    // Get the timelock address from the MarketUpdateProposer contract
    const timelockAddress = await marketUpdateProposerContract.timelock();

    // Create a contract instance for the timelock using its interface
    const timelockContract = await ethers.getContractAt(
      'ITimelock',
      timelockAddress
    );

    // Now call the delay function from the timelock contract
    const delay = (await timelockContract.delay()).toNumber();

    // Fast forward time by more than the GRACE_PERIOD
    const GRACE_PERIOD = 14 * 24 * 60 * 60; // 14 days in seconds
    await advanceTimeAndMineBlock(GRACE_PERIOD + delay + 1);// Increase by 14 days(GRACE_PERIOD) + timelock delay + 1 second

    expect(await marketUpdateProposerContract.state(proposalId)).to.equal(3); // Proposal should be expired

    await expect(
      marketUpdateProposerContract.connect(marketUpdateMultiSig).execute(proposalId)
    ).to.be.revertedWith(
      'MarketUpdateProposer::execute: proposal can only be executed if it is queued'
    );
  });

  describe('MarketUpdateProposer::permissions', function () {
    it('should ensure the addresses are not zero while creating the contract(constructor validation)', async () => {
      const {
        governorTimelockSigner,
        marketUpdateMultiSig,
        marketUpdateProposalGuardianSigner,
        marketUpdateTimelockContract,
      } = await makeMarketAdmin();
      
      const marketUpdaterProposerFactory = (await ethers.getContractFactory(
        'MarketUpdateProposer'
      )) as MarketUpdateProposer__factory;
    
      // Governor as zero address
      await expect(
        marketUpdaterProposerFactory.deploy(
          ethers.constants.AddressZero,
          marketUpdateMultiSig.address,
          marketUpdateProposalGuardianSigner.address,
          marketUpdateTimelockContract.address
        )
      ).to.be.revertedWithCustomError(
        marketUpdaterProposerFactory,
        'InvalidAddress'
      );
        
      // Market admin as zero address
      await expect(
        marketUpdaterProposerFactory.deploy(
          governorTimelockSigner.address,
          ethers.constants.AddressZero,
          marketUpdateProposalGuardianSigner.address,
          marketUpdateTimelockContract.address
        )
      ).to.be.revertedWithCustomError(
        marketUpdaterProposerFactory,
        'InvalidAddress'
      );
        
      await expect(
        marketUpdaterProposerFactory.deploy(
          governorTimelockSigner.address,
          marketUpdateMultiSig.address,
          marketUpdateProposalGuardianSigner.address,
          ethers.constants.AddressZero
        )
      ).to.be.revertedWithCustomError(
        marketUpdaterProposerFactory,
        'InvalidAddress'
      );
        
      const marketUpdateProposer = await marketUpdaterProposerFactory.deploy(
        governorTimelockSigner.address,
        marketUpdateMultiSig.address,
        marketUpdateProposalGuardianSigner.address,
        marketUpdateTimelockContract.address
      );
        
      expect(await marketUpdateProposer.governor()).to.be.equal(governorTimelockSigner.address);
      expect(await marketUpdateProposer.marketAdmin()).to.be.equal(marketUpdateMultiSig.address);
      expect(await marketUpdateProposer.proposalGuardian()).to.be.equal(
        marketUpdateProposalGuardianSigner.address
      );
      expect(await marketUpdateProposer.timelock()).to.be.equal(marketUpdateTimelockContract.address);
      
    });

    it('only governor can update a governor', async () => {
      // include checks for proposalGuardian, marketAdmin, and nonGovernor for failure scenario
      const {
        governorTimelockSigner,
        marketUpdateProposerContract,
        marketUpdateMultiSig,
        marketUpdateProposalGuardianSigner,
      } = await makeMarketAdmin();
  
      const {
        users: [alice, bob],
      } = await makeConfigurator();
      
      expect(await marketUpdateProposerContract.governor()).to.be.equal(governorTimelockSigner.address);
  
      // Ensure only the governor can set a new governor
      await marketUpdateProposerContract
        .connect(governorTimelockSigner)
        .setGovernor(alice.address);
  
      expect(await marketUpdateProposerContract.governor()).to.equal(alice.address);
  
      // failure case: market admin cannot update the governor
      await expect(
        marketUpdateProposerContract.connect(marketUpdateMultiSig).setGovernor(alice.address)
      ).to.be.revertedWithCustomError(marketUpdateProposerContract, 'Unauthorized');
      
      // failure case: proposalGuardian cannot update the governor
      await expect(
        marketUpdateProposerContract
          .connect(marketUpdateProposalGuardianSigner)
          .setGovernor(alice.address)
      ).to.be.revertedWithCustomError(marketUpdateProposerContract, 'Unauthorized');
      
      // failure case: Non-governor cannot update the governor
      await expect(
        marketUpdateProposerContract.connect(bob).setGovernor(alice.address)
      ).to.be.revertedWithCustomError(marketUpdateProposerContract, 'Unauthorized');
    });

    it('only governor can update a marketAdmin', async () => {
      // include checks for proposalGuardian, marketAdmin, and nonGovernor for failure scenario
      const {
        governorTimelockSigner,
        marketUpdateProposerContract,
        marketUpdateMultiSig,
        marketUpdateProposalGuardianSigner,
      } = await makeMarketAdmin();
  
      const {
        users: [alice, bob],
      } = await makeConfigurator();
      
      expect(await marketUpdateProposerContract.governor()).to.be.equal(governorTimelockSigner.address);
  
      // Ensure only the governor can set a new market admin
      await marketUpdateProposerContract
        .connect(governorTimelockSigner)
        .setMarketAdmin(alice.address);
  
      expect(await marketUpdateProposerContract.marketAdmin()).to.equal(alice.address);
  
      // failure case: market admin cannot update the market admin
      await expect(
        marketUpdateProposerContract.connect(marketUpdateMultiSig).setMarketAdmin(alice.address)
      ).to.be.revertedWithCustomError(marketUpdateProposerContract, 'Unauthorized');
      
      // failure case: proposalGuardian cannot update the market admin
      await expect(
        marketUpdateProposerContract
          .connect(marketUpdateProposalGuardianSigner)
          .setMarketAdmin(alice.address)
      ).to.be.revertedWithCustomError(marketUpdateProposerContract, 'Unauthorized');
      
      // failure case: Non-governor cannot update the market admin
      await expect(
        marketUpdateProposerContract.connect(bob).setGovernor(alice.address)
      ).to.be.revertedWithCustomError(marketUpdateProposerContract, 'Unauthorized');
    });

    it('only governor can update a proposalGuardian', async () => {
      // include checks for proposalGuardian, marketAdmin, and nonGovernor for failure scenario
      const {
        governorTimelockSigner,
        marketUpdateProposerContract,
        marketUpdateMultiSig,
      } = await makeMarketAdmin();
  
      const {
        users: [alice, bob, john],
      } = await makeConfigurator();
      
      expect(await marketUpdateProposerContract.governor()).to.be.equal(governorTimelockSigner.address);
  
      // Ensure only the governor can set a new proposalGuardian
      await marketUpdateProposerContract
        .connect(governorTimelockSigner)
        .setProposalGuardian(alice.address);
  
      expect(await marketUpdateProposerContract.proposalGuardian()).to.equal(alice.address);
  
      // failure case: market admin cannot update the proposalGuardian
      await expect(
        marketUpdateProposerContract.connect(marketUpdateMultiSig).setProposalGuardian(bob.address)
      ).to.be.revertedWithCustomError(marketUpdateProposerContract, 'Unauthorized');
      
      // failure case: proposalGuardian cannot update the proposalGuardian
      // alice is the proposalGuardian by the above governor call
      await expect(
        marketUpdateProposerContract.connect(alice).setProposalGuardian(bob.address)
      ).to.be.revertedWithCustomError(marketUpdateProposerContract, 'Unauthorized');
      
      // failure case: Non-governor cannot update the proposalGuardian
      await expect(
        marketUpdateProposerContract.connect(john).setGovernor(alice.address)
      ).to.be.revertedWithCustomError(marketUpdateProposerContract, 'Unauthorized');
    });

    it('only marketAdmin can create a proposal', async () => {
      // include checks for proposalGuardian, governor, and anonymous address
      const {
        governorTimelockSigner,
        marketUpdateProposerContract,
        marketUpdateMultiSig,
        marketUpdateProposalGuardianSigner,
      } = await makeMarketAdmin();
  
      const { configuratorProxy, cometProxy, users: [alice] } = await makeConfigurator();
      
      expect(await marketUpdateProposerContract.marketAdmin()).to.be.equal(
        marketUpdateMultiSig.address
      );
  
      let setSupplyKinkCalldata = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint64'],
        [cometProxy.address, 100]
      );
  
      const proposalDescription = 'Test Proposal';
  
      // only MarketAdmin can create a proposal
      await marketUpdateProposerContract
        .connect(marketUpdateMultiSig)
        .propose(
          [configuratorProxy.address],
          [0],
          ['setSupplyKink(address,uint64)'],
          [setSupplyKinkCalldata],
          proposalDescription
        );
  
      // Failure case: Governor cannot create a proposal
      await expect(
        marketUpdateProposerContract
          .connect(governorTimelockSigner)
          .propose(
            [configuratorProxy.address],
            [0],
            ['setSupplyKink(address,uint64)'],
            [setSupplyKinkCalldata],
            proposalDescription
          )
      ).to.be.revertedWithCustomError(marketUpdateProposerContract, 'Unauthorized');
      
      // Failure case: proposalGuardian cannot create a proposal
      await expect(
        marketUpdateProposerContract
          .connect(marketUpdateProposalGuardianSigner)
          .propose(
            [configuratorProxy.address],
            [0],
            ['setSupplyKink(address,uint64)'],
            [setSupplyKinkCalldata],
            proposalDescription
          )
      ).to.be.revertedWithCustomError(marketUpdateProposerContract, 'Unauthorized');
      
      // Failure case: anonymous cannot create a proposal
      await expect(
        marketUpdateProposerContract
          .connect(alice)
          .propose(
            [configuratorProxy.address],
            [0],
            ['setSupplyKink(address,uint64)'],
            [setSupplyKinkCalldata],
            proposalDescription
          )
      ).to.be.revertedWithCustomError(marketUpdateProposerContract, 'Unauthorized');
    });

    it('only marketAdmin can execute a proposal', async () => {
      // include checks for proposalGuardian, marketAdmin, governor, and anonymous address
      const {
        governorTimelockSigner,
        marketUpdateProposerContract,
        marketUpdateMultiSig,
        marketUpdateTimelockContract,
        marketUpdateProposalGuardianSigner,
        marketAdminPermissionCheckerContract
      } = await makeMarketAdmin();

      const {
        configuratorProxy,
        configurator,
        cometProxy,
        users: [bob],
      } = await makeConfigurator(
        { governor: governorTimelockSigner, marketAdminPermissionCheckerContract: marketAdminPermissionCheckerContract }
      );
      
      expect(await marketUpdateProposerContract.marketAdmin()).to.be.equal(
        marketUpdateMultiSig.address
      );
  
      let setSupplyKinkCalldata = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint64'],
        [cometProxy.address, 100]
      );
  
      const proposalDescription = 'Test Proposal';
  
      // only MarketAdmin can create a proposal
      await marketUpdateProposerContract
        .connect(marketUpdateMultiSig)
        .propose(
          [configuratorProxy.address],
          [0],
          ['setSupplyKink(address,uint64)'],
          [setSupplyKinkCalldata],
          proposalDescription
        );
        
      const delay = (await marketUpdateTimelockContract.delay()).toNumber(); // Example: 172800 for 2 days
      // Fast-forward time by delay + few seconds to surpass the eta
      await advanceTimeAndMineBlock(delay);
      
      const proposalId = 1n;
      
      // Failure case: Governor cannot execute the proposal
      await expect(
        marketUpdateProposerContract.connect(governorTimelockSigner).execute(proposalId)
      ).to.be.revertedWithCustomError(marketUpdateProposerContract, 'Unauthorized');
      
      // Failure case: proposalGuardian cannot execute the proposal
      await expect(
        marketUpdateProposerContract.connect(marketUpdateProposalGuardianSigner).execute(proposalId)
      ).to.be.revertedWithCustomError(marketUpdateProposerContract, 'Unauthorized');
      
      // Failure case: anonymous cannot execute the proposal
      await expect(
        marketUpdateProposerContract.connect(bob).execute(proposalId)
      ).to.be.revertedWithCustomError(marketUpdateProposerContract, 'Unauthorized');
      
      // Success case: only MarketAdmin can execute the proposal
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      const marketAdminCheckerAddress = await configuratorAsProxy.marketAdminPermissionChecker();
      const MarketAdminPermissionChecker = (await ethers.getContractFactory(
        'MarketAdminPermissionChecker'
      )) as MarketAdminPermissionChecker__factory;
      const marketAdminCheckerInstance = MarketAdminPermissionChecker.attach(
        marketAdminCheckerAddress
      );
      await marketAdminCheckerInstance
        .connect(governorTimelockSigner)
        .setMarketAdmin(marketUpdateTimelockContract.address);

      expect(await marketAdminCheckerInstance.marketAdmin()).to.be.equal(
        marketUpdateTimelockContract.address
      );
      await marketUpdateProposerContract.connect(marketUpdateMultiSig).execute(proposalId);
    });
    
    it('only marketAdmin, proposalGuardian, or governor can cancel a proposal', async () => {
      // include checks for proposalGuardian, marketAdmin, and governor, and anonymous address
      const {
        governorTimelockSigner,
        marketUpdateProposerContract,
        marketUpdateMultiSig,
        marketUpdateProposalGuardianSigner,
      } = await makeMarketAdmin();
  
      const { configuratorProxy, cometProxy, users: [bob] } = await makeConfigurator();
      
      expect(await marketUpdateProposerContract.marketAdmin()).to.be.equal(
        marketUpdateMultiSig.address
      );
  
      let setSupplyKinkCalldata = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint64'],
        [cometProxy.address, 100]
      );
  
      const proposalDescription = 'Test Proposal';
  
      // only MarketAdmin can create a proposal
      await marketUpdateProposerContract
        .connect(marketUpdateMultiSig)
        .propose(
          [configuratorProxy.address],
          [0],
          ['setSupplyKink(address,uint64)'],
          [setSupplyKinkCalldata],
          proposalDescription
        );
      const proposalId = 1n;
      
      // Success case: Governor can cancel the proposal
      expect(await marketUpdateProposerContract.connect(governorTimelockSigner).cancel(proposalId));
      
      // Success case: MarketAdmin can cancel the proposal
      await marketUpdateProposerContract.connect(marketUpdateMultiSig).cancel(proposalId);
      
      // Success case: proposalGuardian can cancel the proposal
      expect(
        await marketUpdateProposerContract
          .connect(marketUpdateProposalGuardianSigner)
          .cancel(proposalId)
      ); 
      
      // Failure case: anonymous cannot cancel the proposal
      await expect(
        marketUpdateProposerContract.connect(bob).cancel(proposalId)
      ).to.be.revertedWithCustomError(marketUpdateProposerContract, 'Unauthorized');
      
    });
  });
});
