import { makeMarketAdmin } from './market-updates-helper';
import { expect, makeConfigurator, ethers } from '../helpers';

describe('MarketUpdateTimelock', function() {
  it('is created properly with main-governor-timelock as admin', async () => {
    const { marketUpdateTimelock, governorTimelock } = await makeMarketAdmin();

    expect(await marketUpdateTimelock.admin()).to.equal(
      governorTimelock.address
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
      'MarketUpdateTimelock::setMarketUpdateProposer: Call must come from admin.'
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

    const latestBlock = await ethers.provider.getBlock('latest');
    const currentTimestamp = latestBlock.timestamp;

    const eta = currentTimestamp + 5; // Ensure eta is in the future

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
      'MarketUpdateTimelock::Unauthorized: call must come from admin or marketAdmin'
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

    let latestBlock = await ethers.provider.getBlock('latest');
    let currentTimestamp = latestBlock.timestamp;

    let eta = currentTimestamp + 5; // Ensure eta is in the future

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

    // Fast-forward time by 5 seconds to surpass the eta
    await ethers.provider.send('evm_increaseTime', [5]);
    await ethers.provider.send('evm_mine', []); // Mine a new block to apply the time increase

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

    await marketUpdateProposer
      .connect(marketUpdateMultiSig)
      .execute(proposalId);

    // ensuring that none other than the main-governor-timelock or MarketUpdateProposer can execute transactions

    // first queuing a transaction
    latestBlock = await ethers.provider.getBlock('latest');
    currentTimestamp = latestBlock.timestamp;

    eta = currentTimestamp + 5; // Ensure eta is in the future

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

    // Fast-forward time by 5 seconds to surpass the eta
    await ethers.provider.send('evm_increaseTime', [5]);
    await ethers.provider.send('evm_mine', []); // Mine a new block to apply the time increase

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
      'MarketUpdateTimelock::Unauthorized: call must come from admin or marketAdmin'
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

    let latestBlock = await ethers.provider.getBlock('latest');
    let currentTimestamp = latestBlock.timestamp;

    let eta = currentTimestamp + 5; // Ensure eta is in the future

    // ensuring that main gover-timelock can cancel transactions
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

    // ensuring that MarketUpdateProposer can cacnel transactions
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

    eta = currentTimestamp + 5; // Ensure eta is in the future

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
      'MarketUpdateTimelock::Unauthorized: call must come from admin or marketAdmin'
    );
  });

  it('only main-governor-timelock can set new admin', async () => {
    const {
      marketUpdateTimelock,
      governorTimelockSigner,
    } = await makeMarketAdmin();

    const {
      users: [alice, bob],
    } = await makeConfigurator();

    await marketUpdateTimelock
      .connect(governorTimelockSigner)
      .setAdmin(alice.address);

    expect(await marketUpdateTimelock.admin()).to.equal(alice.address);

    await expect(
      marketUpdateTimelock.connect(bob).setAdmin(bob.address)
    ).to.be.revertedWith(
      'MarketUpdateTimelock::setAdmin: Call must come from admin.'
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
      'MarketUpdateTimelock::setMarketUpdateProposer: Call must come from admin.'
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
      marketUpdateTimelock.connect(marketUpdateMultiSig).setAdmin(bob.address)
    ).to.be.revertedWith(
      'MarketUpdateTimelock::setAdmin: Call must come from admin.'
    );
  });
});
