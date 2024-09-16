import { makeMarketAdmin, advanceTimeAndMineBlock } from './market-updates-helper';
import { expect, makeConfigurator, ethers } from '../helpers';

describe('MarketUpdateTimelock', function() {
  it('is created properly with main-governor-timelock as governor', async () => {
    const { marketUpdateTimelock, governorTimelockSigner } = await makeMarketAdmin();

    expect(await marketUpdateTimelock.governor()).to.equal(
      governorTimelockSigner.address
    );
  });

  it('only allows main-governor-timelock to set MarketUpdateProposer', async () => {
    const {
      marketUpdateTimelock,
      governorTimelockSigner,
    } = await makeMarketAdmin();

    const {
      users: [alice, bob],
    } = await makeConfigurator();

    await marketUpdateTimelock
      .connect(governorTimelockSigner)
      .setMarketUpdateProposer(alice.address);

    expect(await marketUpdateTimelock.marketUpdateProposer()).to.equal(
      alice.address
    );

    await expect(
      marketUpdateTimelock.connect(bob).setMarketUpdateProposer(bob.address)
    ).to.be.revertedWith(
      'MarketUpdateTimelock::setMarketUpdateProposer: Call must come from governor.'
    );
  });

  it('only MarketUpdateProposer or main-governor-timelock can queue transactions', async () => {
    const {
      marketUpdateTimelock,
      governorTimelockSigner,
      marketUpdateProposer,
      marketUpdateMultiSig,
    } = await makeMarketAdmin();

    const {
      configuratorProxy,
      cometProxy,
      users: [bob],
    } = await makeConfigurator();

    // Get the delay from the contract
    const delay = (await marketUpdateTimelock.delay()).toNumber(); // Example: 172800 for 2 days

    const latestBlock = await ethers.provider.getBlock('latest');
    const currentTimestamp = latestBlock.timestamp;

    // Ensure eta is sufficiently in the future
    const eta = currentTimestamp + delay + 5; // eta is current timestamp + delay + a few seconds

    // ensuring that main gover-timelock can queue transactions
    await marketUpdateTimelock
      .connect(governorTimelockSigner)
      .queueTransaction(
        configuratorProxy.address,
        0,
        'setSupplyKink(address, uint64)',
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint64'],
          [cometProxy.address, 100]
        ),
        eta
      );

    // ensuring that market update proposer can queue transactions
    await marketUpdateProposer
      .connect(marketUpdateMultiSig)
      .propose(
        [configuratorProxy.address],
        [0],
        ['setSupplyKink(address, uint64)'],
        [
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'uint64'],
            [cometProxy.address, 100]
          ),
        ],
        'Setting supply kink to 100'
      );

    // ensuring that none other than the main-governor-timelock or MarketUpdateProposer can queue transactions
    await expect(
      marketUpdateTimelock
        .connect(bob)
        .queueTransaction(
          configuratorProxy.address,
          0,
          'setSupplyKink(address, uint64)',
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'uint64'],
            [cometProxy.address, 100]
          ),
          eta
        )
    ).to.be.revertedWith(
      'MarketUpdateTimelock::Unauthorized: call must come from governor or marketAdmin'
    );
  });

  it('only MarketUpdateProposer or main-governor-timelock can execute transactions', async () => {
    const {
      marketUpdateTimelock,
      governorTimelockSigner,
      marketUpdateProposer,
      marketUpdateMultiSig,
    } = await makeMarketAdmin();

    const {
      configuratorProxy,
      configurator,
      cometProxy,
      users: [bob],
    } = await makeConfigurator();

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);
    configuratorAsProxy.transferGovernor(marketUpdateTimelock.address);
    const proposalId = 1n;

    // Get the delay from the contract
    const delay = (await marketUpdateTimelock.delay()).toNumber(); // Example: 172800 for 2 days

    let latestBlock = await ethers.provider.getBlock('latest');
    let currentTimestamp = latestBlock.timestamp;

    let eta = currentTimestamp + delay + 5; // Ensure eta is in the future

    // ensuring that main gover-timelock can execute transactions
    await marketUpdateTimelock
      .connect(governorTimelockSigner)
      .queueTransaction(
        configuratorProxy.address,
        0,
        'setSupplyKink(address,uint64)',
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint64'],
          [cometProxy.address, 100000]
        ),
        eta
      );

    // Fast-forward time by delay + few seconds to surpass the eta
    await advanceTimeAndMineBlock(delay);

    await marketUpdateTimelock
      .connect(governorTimelockSigner)
      .executeTransaction(
        configuratorProxy.address,
        0,
        'setSupplyKink(address,uint64)',
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint64'],
          [cometProxy.address, 100000]
        ),
        eta
      );

    // ensuring that market update proposer can queue transactions
    await marketUpdateProposer
      .connect(marketUpdateMultiSig)
      .propose(
        [configuratorProxy.address],
        [0],
        ['setSupplyKink(address,uint64)'],
        [
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'uint64'],
            [cometProxy.address, 100]
          ),
        ],
        'Setting supply kink to 100'
      );

    // Fast-forward time by delay + seconds to surpass the eta
    await advanceTimeAndMineBlock(delay);

    await marketUpdateProposer
      .connect(marketUpdateMultiSig)
      .execute(proposalId);

    // ensuring that none other than the main-governor-timelock or MarketUpdateProposer can execute transactions

    // first queuing a transaction
    latestBlock = await ethers.provider.getBlock('latest');
    currentTimestamp = latestBlock.timestamp;

    eta = currentTimestamp + delay + 5; // Ensure eta is in the future

    // ensuring that MarketUpdateProposer can execute transactions
    await marketUpdateTimelock
      .connect(governorTimelockSigner)
      .queueTransaction(
        configuratorProxy.address,
        0,
        'setSupplyKink(address,uint64)',
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint64'],
          [cometProxy.address, 100000]
        ),
        eta
      );

    // Fast-forward time by delay + few seconds to surpass the eta
    await advanceTimeAndMineBlock(delay);

    await expect(
      marketUpdateTimelock
        .connect(bob)
        .executeTransaction(
          configuratorProxy.address,
          0,
          'setSupplyKink(address,uint64)',
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'uint64'],
            [cometProxy.address, 100000]
          ),
          eta
        )
    ).to.be.revertedWith(
      'MarketUpdateTimelock::Unauthorized: call must come from governor or marketAdmin'
    );
  });

  it('only MarketUpdateProposer or main-governor-timelock can cancel transactions', async () => {
    const {
      marketUpdateTimelock,
      governorTimelockSigner,
      marketUpdateProposer,
      marketUpdateMultiSig,
    } = await makeMarketAdmin();

    const {
      configuratorProxy,
      configurator,
      cometProxy,
      users: [bob],
    } = await makeConfigurator();

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);
    await configuratorAsProxy.transferGovernor(marketUpdateTimelock.address);

    const proposalId = 1n;

    // Get the delay from the contract
    const delay = (await marketUpdateTimelock.delay()).toNumber(); // Example: 172800 for 2 days

    let latestBlock = await ethers.provider.getBlock('latest');
    let currentTimestamp = latestBlock.timestamp;

    let eta = currentTimestamp + delay + 5; // Ensure eta is in the future

    // ensuring that main governor-timelock can cancel transactions
    await marketUpdateTimelock
      .connect(governorTimelockSigner)
      .queueTransaction(
        configuratorProxy.address,
        0,
        'setSupplyKink(address,uint64)',
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint64'],
          [cometProxy.address, 100000]
        ),
        eta
      );

    await marketUpdateTimelock
      .connect(governorTimelockSigner)
      .cancelTransaction(
        configuratorProxy.address,
        0,
        'setSupplyKink(address,uint64)',
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint64'],
          [cometProxy.address, 100000]
        ),
        eta
      );

    // ensuring that MarketUpdateProposer can cancel transactions
    await marketUpdateProposer
      .connect(marketUpdateMultiSig)
      .propose(
        [configuratorProxy.address],
        [0],
        ['setSupplyKink(address,uint64)'],
        [
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'uint64'],
            [cometProxy.address, 100]
          ),
        ],
        'Setting supply kink to 100'
      );

    await marketUpdateProposer.connect(marketUpdateMultiSig).cancel(proposalId);

    // Checking the state of the transaction using the txHash
    const txHash = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint', 'string', 'bytes', 'uint'],
        [
          configuratorProxy.address,
          0,
          'setSupplyKink(address,uint64)',
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'uint64'],
            [cometProxy.address, 100000]
          ),
          eta,
        ]
      )
    );

    expect(await marketUpdateTimelock.queuedTransactions(txHash)).to.equal(
      false
    );

    // ensuring that none other than the main-governor-timelock or MarketUpdateProposer can execute transactions

    // first queuing a transaction
    latestBlock = await ethers.provider.getBlock('latest');
    currentTimestamp = latestBlock.timestamp;

    eta = currentTimestamp + delay + 5; // Ensure eta is in the future

    // ensuring that MarketUpdateProposer can execute transactions
    await marketUpdateTimelock
      .connect(governorTimelockSigner)
      .queueTransaction(
        configuratorProxy.address,
        0,
        'setSupplyKink(address,uint64)',
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint64'],
          [cometProxy.address, 100000]
        ),
        eta
      );

    await expect(
      marketUpdateTimelock
        .connect(bob)
        .cancelTransaction(
          configuratorProxy.address,
          0,
          'setSupplyKink(address,uint64)',
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'uint64'],
            [cometProxy.address, 100000]
          ),
          eta
        )
    ).to.be.revertedWith(
      'MarketUpdateTimelock::Unauthorized: call must come from governor or marketAdmin'
    );
  });

  it('only main-governor-timelock can set new governor', async () => {
    const {
      marketUpdateTimelock,
      governorTimelockSigner,
    } = await makeMarketAdmin();

    const {
      users: [alice, bob],
    } = await makeConfigurator();

    await marketUpdateTimelock
      .connect(governorTimelockSigner)
      .setGovernor(alice.address);

    expect(await marketUpdateTimelock.governor()).to.equal(alice.address);

    await expect(
      marketUpdateTimelock.connect(bob).setGovernor(bob.address)
    ).to.be.revertedWith(
      'MarketUpdateTimelock::setGovernor: Call must come from governor.'
    );
  });

  it('MarketUpdateProposer cannot set or update MarketUpdateProposer', async () => {
    const {
      marketUpdateTimelock,
      marketUpdateMultiSig,
    } = await makeMarketAdmin();

    const {
      users: [bob],
    } = await makeConfigurator();

    await expect(
      marketUpdateTimelock
        .connect(marketUpdateMultiSig)
        .setMarketUpdateProposer(bob.address)
    ).to.be.revertedWith(
      'MarketUpdateTimelock::setMarketUpdateProposer: Call must come from governor.'
    );
  });

  it('MarketUpdateProposer cannot set or update main-governor-timelock', async () => {
    const {
      marketUpdateTimelock,
      marketUpdateMultiSig,
    } = await makeMarketAdmin();

    const {
      users: [bob],
    } = await makeConfigurator();

    await expect(
      marketUpdateTimelock.connect(marketUpdateMultiSig).setGovernor(bob.address)
    ).to.be.revertedWith(
      'MarketUpdateTimelock::setGovernor: Call must come from governor.'
    );
  });
});