import { makeMarketAdmin, advanceTimeAndMineBlock } from './market-updates-helper';
import { expect, makeConfigurator, ethers, wait, event } from '../helpers';

describe('MarketUpdateProposer', function() {
  // We are not checking market updates here. we are just checking interaction
  // between MarketUpdateMultisig and MarketUpdateProposer or checking interactions
  // on MarketUpdateProposer
  it('is initialized properly with timelock', async () => {
    const {
      marketUpdateProposer,
      marketUpdateTimelock,
    } = await makeMarketAdmin();

    expect(await marketUpdateProposer.timelock()).to.equal(
      marketUpdateTimelock.address
    );
  });

  it('throw error if MarketUpdateProposer is initialized twice', async () => {
    const {
      marketUpdateProposer,
      marketUpdateTimelock,
    } = await makeMarketAdmin();

    await expect(
      marketUpdateProposer.initialize(marketUpdateTimelock.address)
    ).to.be.revertedWithCustomError(marketUpdateProposer, 'AlreadyInitialized');
  });

  it('MarketUpdateMultisig is set as the owner of MarketUpdateProposer', async () => {
    const {
      marketUpdateProposer,
      marketUpdateMultiSig,
    } = await makeMarketAdmin();

    expect(await marketUpdateProposer.owner()).to.equal(
      marketUpdateMultiSig.address
    );
  });

  it('MarketUpdateMultisig can set a new owner for MarketUpdateProposer', async () => {
    const {
      marketUpdateProposer,
      marketUpdateMultiSig,
    } = await makeMarketAdmin();

    const {
      users: [alice],
    } = await makeConfigurator();

    expect(await marketUpdateProposer.owner()).to.equal(
      marketUpdateMultiSig.address
    );

    await marketUpdateProposer
      .connect(marketUpdateMultiSig)
      .transferOwnership(alice.address);

    expect(await marketUpdateProposer.owner()).to.equal(alice.address);
  });

  it('only allows MarketUpdateMultisig to create proposal', async () => {
    const {
      marketUpdateProposer,
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
      marketUpdateProposer
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
      marketUpdateProposer
        .connect(alice)
        .propose(
          [configuratorProxy.address],
          [0],
          ['setSupplyKink(address,uint64)'],
          [setSupplyKinkCalldata],
          proposalDescription
        )
    ).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it('keeps track of all the proposals', async () => {
    const {
      marketUpdateProposer,
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
    await marketUpdateProposer
      .connect(marketUpdateMultiSig)
      .propose(
        [configuratorProxy.address],
        [0],
        ['setSupplyKink(address,uint64)'],
        [setSupplyKinkCalldata],
        proposalDescription
      );

    // Checks the proposal
    const proposal = await marketUpdateProposer.getProposal(proposalId);

    expect(proposal.id).to.equal(proposalId);
    expect(proposal.proposer).to.equal(marketUpdateMultiSig.address);
    expect(proposal.targets[0]).to.equal(configuratorProxy.address);
    expect(proposal.signatures[0]).to.equal('setSupplyKink(address,uint64)');
    expect(proposal.calldatas[0]).to.equal(setSupplyKinkCalldata);
    expect(proposal.description).to.equal(proposalDescription);
  });

  it('can cancel the proposal', async () => {
    // Create a proposal
    // Cancel the proposal
    // Check if the proposal is cancelled
    const {
      marketUpdateProposer,
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
    await marketUpdateProposer
      .connect(marketUpdateMultiSig)
      .propose(
        [configuratorProxy.address],
        [0],
        ['setSupplyKink(address,uint64)'],
        [setSupplyKinkCalldata],
        proposalDescription
      );

    expect(
      (await marketUpdateProposer.proposals(proposalId)).canceled
    ).to.be.equal(false);

    // Cancel the proposal
    await marketUpdateProposer.connect(marketUpdateMultiSig).cancel(proposalId);

    expect(
      (await marketUpdateProposer.proposals(proposalId)).canceled
    ).to.be.equal(true);

    await expect(
      marketUpdateProposer.connect(marketUpdateMultiSig).execute(proposalId)
    ).to.be.revertedWith(
      'MarketUpdateProposer::execute: proposal can only be executed if it is queued'
    );
  });

  it('marks the proposal as expired after grace period', async () => {
    const {
      marketUpdateProposer,
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
    await marketUpdateProposer
      .connect(marketUpdateMultiSig)
      .propose(
        [configuratorProxy.address],
        [0],
        ['setSupplyKink(address,uint64)'],
        [setSupplyKinkCalldata],
        proposalDescription
      );

    // Get the timelock address from the MarketUpdateProposer contract
    const timelockAddress = await marketUpdateProposer.timelock();

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

    expect(await marketUpdateProposer.state(proposalId)).to.equal(3); // Proposal should be expired

    await expect(
      marketUpdateProposer.connect(marketUpdateMultiSig).execute(proposalId)
    ).to.be.revertedWith(
      'MarketUpdateProposer::execute: proposal can only be executed if it is queued'
    );
  });
});
