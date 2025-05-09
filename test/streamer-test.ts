import { expect } from 'chai';
import { network, ethers } from 'hardhat';


describe.only('streamer', function () {
  let snapshot;
  const timelockAddress = '0x6d903f6003cca6255D85CcA4D3B5E5146dC33925';
  const comptrollerV2Address = '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b';
  const CompAddress = '0xc00e94Cb662C3520282E6f5717214004A7f26888';
  before(async () => {
    snapshot = await network.provider.request({
      method: 'evm_snapshot',
      params: [],
    });
  });

  async function setup() {
    const [user] = await ethers.getSigners();
    const streamerFactory = await ethers.getContractFactory('Streamer');
    const streamer = await streamerFactory.deploy(user.address);
    await streamer.deployed();

    const comptrollerV2 = new ethers.Contract(
      comptrollerV2Address,
      [
        'function _grantComp(address recipient, uint256 amount) external',
      ],
      ethers.provider
    );
    const COMP = new ethers.Contract(
      CompAddress,
      [
        'function balanceOf(address account) external view returns (uint256)',
        'function transfer(address to, uint256 amount) external returns (bool)',
      ],
      ethers.provider
    );
    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [timelockAddress],
    }); 

    await network.provider.request({
      method: 'hardhat_setBalance',
      params: [timelockAddress, '0x100000000000000000'],
    });
    const timelockSigner = await ethers.getSigner(timelockAddress);
    await comptrollerV2.connect(timelockSigner)._grantComp(streamer.address, await streamer.calculateCompAmount(2_400_000e6));
    await streamer.connect(timelockSigner).initialize();
    return { user, streamer, comptrollerV2, timelockSigner, COMP };
  }

  afterEach(async () => {
    await network.provider.request({
      method: 'evm_revert',
      params: [snapshot],
    });
    snapshot = await network.provider.request({
      method: 'evm_snapshot',
      params: [],
    });
  });

  it('should initialize', async () => {
    const [user] = await ethers.getSigners();
    const streamerFactory = await ethers.getContractFactory('Streamer');
    const streamer = await streamerFactory.deploy(user.address);
    await streamer.deployed();

    const comptrollerV2 = new ethers.Contract(
      comptrollerV2Address,
      [
        'function _grantComp(address recipient, uint256 amount) external',
      ],
      ethers.provider
    );
    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [timelockAddress],
    }); 

    await network.provider.request({
      method: 'hardhat_setBalance',
      params: [timelockAddress, '0x100000000000000000'],
    });
    const timelockSigner = await ethers.getSigner(timelockAddress);
    await comptrollerV2.connect(timelockSigner)._grantComp(streamer.address, await streamer.calculateCompAmount(2_400_000e6));
    await streamer.connect(timelockSigner).initialize();
    expect(await streamer.startTimestamp()).to.be.gt(0);
  });

  it('should not initialize with not enough supply', async () => {
    const [user] = await ethers.getSigners();
    const streamerFactory = await ethers.getContractFactory('Streamer');
    const streamer = await streamerFactory.deploy(user.address);
    await streamer.deployed();

    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [timelockAddress],
    });
    await network.provider.request({
      method: 'hardhat_setBalance',
      params: [timelockAddress, '0x100000000000000000'],
    });
    const timelockSigner = await ethers.getSigner(timelockAddress);

    await expect(streamer.connect(timelockSigner).initialize()).to.be.revertedWithCustomError(
      streamer,
      'NotEnoughBalance'
    );
  });

  it('should not initialize from non-timelock', async () => {
    const [user] = await ethers.getSigners();
    const streamerFactory = await ethers.getContractFactory('Streamer');
    const streamer = await streamerFactory.deploy(user.address);
    await streamer.deployed();

    await expect(streamer.connect(user).initialize()).to.be.revertedWithCustomError(
      streamer,
      'OnlyTimelock'
    );
  });
  
  it('should not initialize second time', async () => {
    const [user] = await ethers.getSigners();
    const streamerFactory = await ethers.getContractFactory('Streamer');
    const streamer = await streamerFactory.deploy(user.address);
    await streamer.deployed();

    const comptrollerV2 = new ethers.Contract(
      comptrollerV2Address,
      [
        'function _grantComp(address recipient, uint256 amount) external',
      ],
      ethers.provider
    );
    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [timelockAddress],
    }); 

    // set balance
    await network.provider.request({
      method: 'hardhat_setBalance',
      params: [timelockAddress, '0x100000000000000000'],
    });
    const timelockSigner = await ethers.getSigner(timelockAddress);
    await comptrollerV2.connect(timelockSigner)._grantComp(streamer.address, await streamer.calculateCompAmount(2_400_000e6));
    await streamer.connect(timelockSigner).initialize();

    await expect(streamer.connect(timelockSigner).initialize()).to.be.revertedWithCustomError(
      streamer,
      'AlreadyInitialized'
    );
  });

  it('should revert setting receiver to zero address', async () => {
    const streamerFactory = await ethers.getContractFactory('Streamer');
    await expect(streamerFactory.deploy(ethers.constants.AddressZero)).to.be.revertedWithCustomError(
      streamerFactory,
      'ZeroAddress'
    );
  });

  it('should claim', async () => {
    const { streamer, user } = await setup();
    await streamer.connect(user).claim();

    const COMP = new ethers.Contract(
      CompAddress,
      [
        'function balanceOf(address account) external view returns (uint256)',
      ],
      ethers.provider
    );
    const balance = await COMP.balanceOf(user.address);
    expect(balance).to.be.gt(0);
  });

  it('should not claim before initialization', async () => {
    const [user] = await ethers.getSigners();
    const streamerFactory = await ethers.getContractFactory('Streamer');
    const streamer = await streamerFactory.deploy(user.address);
    await streamer.deployed();

    await expect(streamer.connect(user).claim()).to.be.revertedWithCustomError(
      streamer,
      'NotInitialized'
    );
  });

  it('should not claim from non-receiver', async () => {
    const { streamer, timelockSigner } = await setup();

    await expect(streamer.connect(timelockSigner).claim()).to.be.revertedWithCustomError(
      streamer,
      'NotReceiver'
    );
  });

  it('should claim several times', async () => {
    const { streamer, COMP, user } = await setup();
    let balanceBefore = await COMP.balanceOf(user.address);
    for (let i = 0; i < 5; i++) {
      await streamer.connect(user).claim();
      const balance = await COMP.balanceOf(user.address);
      expect(balance).to.be.gt(balanceBefore);
      balanceBefore = balance;
      await network.provider.request({
        method: 'evm_increaseTime',
        params: [60 * 60 * 24 * 30],
      });
      await network.provider.request({
        method: 'evm_mine',
        params: [],
      });
    }
  });

  it('should allow claim for non-receiver if receiver did not claim for a week', async () => {
    const [,user2] = await ethers.getSigners();
    const { streamer, COMP, user } = await setup();
    
    const balanceBefore = await COMP.balanceOf(user.address);
    await expect(streamer.connect(user2).claim()).to.be.revertedWithCustomError(
      streamer,
      'NotReceiver'
    );
    await network.provider.request({
      method: 'evm_increaseTime',
      params: [60 * 60 * 24 * 7],
    });
    await network.provider.request({
      method: 'evm_mine',
      params: [],
    });
    await streamer.connect(user2).claim();
    const balance = await COMP.balanceOf(user.address);
    expect(balance).to.be.gt(balanceBefore);
  });

  it('should claim all', async () => {
    const { streamer, COMP, user } = await setup();
    let balanceBefore = await COMP.balanceOf(user.address);
    for (let i = 0; i < 12; i++) {
      await network.provider.request({
        method: 'evm_increaseTime',
        params: [60 * 60 * 24 * 31],
      });
      await network.provider.request({
        method: 'evm_mine',
        params: [],
      });
      await streamer.connect(user).claim();
      const balance = await COMP.balanceOf(user.address);
      expect(balance).to.be.gt(balanceBefore);
      balanceBefore = balance;
    }
    const owed = await streamer.getAmountOwed();
    const suppliedAmount = await streamer.suppliedAmount();
    const claimedCompAmount = await streamer.claimedCompAmount();
    expect(owed).to.be.eq(0);
    expect(suppliedAmount).to.be.eq(2_000_000e6);
    expect(claimedCompAmount).to.be.closeTo(await streamer.calculateCompAmount(2_000_000e6), 30);
  });

  it('should sweep all after 1 year', async () => {
    const [,user] = await ethers.getSigners();
    const { streamer, COMP } = await setup();

    await network.provider.request({
      method: 'evm_increaseTime',
      params: [60 * 60 * 24 * 375],
    });
    await network.provider.request({
      method: 'evm_mine',
      params: [],
    });

    await streamer.connect(user).sweepRemaining();
    expect(await COMP.balanceOf(streamer.address)).to.be.eq(0);
  });

  it('should not sweep all before stream is finished', async () => {
    const { streamer, user } = await setup();
    await expect(streamer.connect(user).sweepRemaining()).to.be.revertedWithCustomError(
      streamer,
      'StreamNotFinished'
    );
  });

  it('should sweep all after stream is finished', async () => {
    const [,user2] = await ethers.getSigners();
    const { streamer, COMP, user } = await setup();
    let balanceBefore = await COMP.balanceOf(user.address);
    for (let i = 0; i < 12; i++) {
      await network.provider.request({
        method: 'evm_increaseTime',
        params: [60 * 60 * 24 * 31],
      });
      await network.provider.request({
        method: 'evm_mine',
        params: [],
      });
      await streamer.connect(user).claim();
      const balance = await COMP.balanceOf(user.address);
      expect(balance).to.be.gt(balanceBefore);
      balanceBefore = balance;
    }
    const owed = await streamer.getAmountOwed();
    const suppliedAmount = await streamer.suppliedAmount();
    const claimedCompAmount = await streamer.claimedCompAmount();
    expect(owed).to.be.eq(0);
    expect(suppliedAmount).to.be.eq(2_000_000e6);
    expect(claimedCompAmount).to.be.closeTo(await streamer.calculateCompAmount(2_000_000e6), 30);
    expect(await COMP.balanceOf(streamer.address)).to.be.gt(0);
    await network.provider.request({
      method: 'evm_increaseTime',
      params: [60 * 60 * 24 * 7],
    });
    await network.provider.request({
      method: 'evm_mine',
      params: [],
    });
    await streamer.connect(user2).sweepRemaining();
    expect(await COMP.balanceOf(streamer.address)).to.be.eq(0);
  });

  it('should claim even if balance is not enough', async () => {
    const { streamer, COMP, user } = await setup();
    for (let i = 0; i < 11; i++) {
      await network.provider.request({
        method: 'evm_increaseTime',
        params: [60 * 60 * 24 * 31],
      });
      await network.provider.request({
        method: 'evm_mine',
        params: [],
      });
      await streamer.connect(user).claim();
    }
    let balanceBefore = await COMP.balanceOf(user.address);
    const streamerBalance = await COMP.balanceOf(streamer.address);

    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [streamer.address],
    });
    await network.provider.request({
      method: 'hardhat_setBalance',
      params: [streamer.address, '0x100000000000000000'],
    });
    const streamerSigner = await ethers.getSigner(streamer.address);
    await COMP.connect(streamerSigner).transfer(timelockAddress, BigInt(streamerBalance) - (1000n * (10n ** 18n)));
    await network.provider.request({
      method: 'hardhat_stopImpersonatingAccount',
      params: [streamer.address],
    });
    expect(await COMP.balanceOf(streamer.address)).to.be.eq(1000n * (10n ** 18n));
    await network.provider.request({
      method: 'evm_increaseTime',
      params: [60 * 60 * 24 * 31],
    });
    await network.provider.request({
      method: 'evm_mine',
      params: [],
    });
    const owed = await streamer.getAmountOwed();
    expect(owed).to.be.gt(await streamer.calculateUsdcAmount(1000n * (10n ** 18n)));
    await expect(streamer.connect(user).claim()).to.not.be.reverted;
    expect(ethers.BigNumber.from(await COMP.balanceOf(user.address)).sub(balanceBefore)).to.be.eq(1000n * (10n ** 18n));
    expect(await COMP.balanceOf(streamer.address)).to.be.eq(0);
  });
});
