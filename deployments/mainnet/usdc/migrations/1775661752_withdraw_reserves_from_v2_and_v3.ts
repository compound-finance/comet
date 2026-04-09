import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { utils, Contract, BigNumber } from 'ethers';

const withdrawConfigV2 = {
  cWBTC2: {
    address: '0xccF4429DB6322D5C611ee964527D42E5d685DD6a',
    asset: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    amount: 139,
    decimals: 8,
  },
  cUSDC: {
    address: '0x39AA39c021dfbaE8faC545936693aC917d5E7563',
    asset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    amount: 5_772_174,
    decimals: 6,
  },
  cETH: {
    address: '0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5',
    asset: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    amount: 813,
    decimals: 18,
  },
  cUSDT: {
    address: '0xf650C3d88D12dB855b8bf7D11Be6C55A4e07dCC9',
    asset: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    amount: 1_233_614,
    decimals: 6,
  },
  cBAT: {
    address: '0x6C8c6b02E7b2BE14d4fA6022Dfd6d75921D90E4E',
    asset: '0x0d8775f648430679a709e98d2b0cb6250d2887ef',
    amount: 2_475_186,
    decimals: 18,
  },
  cUNI: {
    address: '0x35A18000230DA775CAc24873d00Ff85BccdeD550',
    asset: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
    amount: 66_056,
    decimals: 18,
  },
  cTUSD: {
    address: '0x12392F67bdf24faE0AF363c24aC620a2f67DAd86',
    asset: '0x0000000000085d4780b73119b644ae5ecd22b376',
    amount: 168_050,
    decimals: 18,
  },
  cLINK: {
    address: '0xFAce851a4921ce59e912d19329929CE6da6EB0c7',
    asset: '0x514910771af9ca656af840dff83e8264ecf986ca',
    amount: 7_874,
    decimals: 18,
  },
  cAAVE: {
    address: '0xe65cdB6479BaC1e22340E4E755fAE7E509EcD06c',
    asset: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
    amount: 265,
    decimals: 18,
  },
  cCOMP: {
    address: '0x70e36f6BF80a52b3B46b3aF8e106CC0ed743E8e4',
    asset: '0xc00e94cb662c3520282e6f5717214004a7f26888',
    amount: 664,
    decimals: 18,
  },
};

const withdrawConfigV3 = {
  cUSDCv3: {
    address: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
    amount: 6_175_604,
    decimals: 6,
  },
  cWBTCv3: {
    address: '0xe85Dc543813B8c2CFEaAc371517b925a166a9293',
    amount: 0.14,
    decimals: 8,
  }
};

const recipient = '0x9825413dd3875E01B34451A7A7e066b2225a234E';

let balancesBefore: Record<string, BigNumber> = {};

async function getErc20FromAddress(dm: DeploymentManager, address: string, ): Promise<Contract> {
  return new Contract(address, ['function balanceOf(address) view returns (uint256)'], await dm.getSigner());
}

export default migration('1775661752_withdraw_reserves_from_v2_and_v3', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {
    const trace = deploymentManager.tracer();

    const {
      governor,
    } = await deploymentManager.getContracts();

    const mainnetActions = [
      // 1. Withdraw reserves from cWBTCv2
      {
        target: withdrawConfigV2.cWBTC2.address,
        signature: '_reduceReserves(uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['uint256'],
          [exp(withdrawConfigV2.cWBTC2.amount, withdrawConfigV2.cWBTC2.decimals)]

        ),
      },
      // 2. Transfer withdrawn BTC to recipient
      {
        target: withdrawConfigV2.cWBTC2.asset,
        signature: 'transfer(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [recipient, exp(withdrawConfigV2.cWBTC2.amount, withdrawConfigV2.cWBTC2.decimals)]
        ),
      },
      // 3. Withdraw reserves from cUSDCv2
      {
        target: withdrawConfigV2.cUSDC.address,
        signature: '_reduceReserves(uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['uint256'],
          [exp(withdrawConfigV2.cUSDC.amount, withdrawConfigV2.cUSDC.decimals)]
        ),
      },
      // 4. Transfer withdrawn USDC to recipient
      {
        target: withdrawConfigV2.cUSDC.asset,
        signature: 'transfer(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [recipient, exp(withdrawConfigV2.cUSDC.amount, withdrawConfigV2.cUSDC.decimals)]
        ),
      },
      // 5. Withdraw reserves from cETHv2
      {
        target: withdrawConfigV2.cETH.address,
        signature: '_reduceReserves(uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['uint256'],
          [exp(withdrawConfigV2.cETH.amount, withdrawConfigV2.cETH.decimals)]
        ),
      },
      // 6. Transfer withdrawn ETH to recipient
      {
        target: recipient,
        signature: '',
        value: exp(withdrawConfigV2.cETH.amount, withdrawConfigV2.cETH.decimals),
        calldata: '0x',
      },
      // 7. Withdraw reserves from cUSDTv2
      {
        target: withdrawConfigV2.cUSDT.address,
        signature: '_reduceReserves(uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['uint256'],
          [exp(withdrawConfigV2.cUSDT.amount, withdrawConfigV2.cUSDT.decimals)]
        ),
      },
      // 8. Transfer withdrawn USDT to recipient
      {
        target: withdrawConfigV2.cUSDT.asset,
        signature: 'transfer(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [recipient, exp(withdrawConfigV2.cUSDT.amount, withdrawConfigV2.cUSDT.decimals)]
        ),
      },
      // 9. Withdraw reserves from cBATv2
      {
        target: withdrawConfigV2.cBAT.address,
        signature: '_reduceReserves(uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['uint256'],
          [exp(withdrawConfigV2.cBAT.amount, withdrawConfigV2.cBAT.decimals)]
        ),
      },
      // 10. Transfer withdrawn BAT to recipient
      {
        target: withdrawConfigV2.cBAT.asset,
        signature: 'transfer(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [recipient, exp(withdrawConfigV2.cBAT.amount, withdrawConfigV2.cBAT.decimals)]
        ),
      },
      // 11. Withdraw reserves from cUNIv2
      {
        target: withdrawConfigV2.cUNI.address,
        signature: '_reduceReserves(uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['uint256'],
          [exp(withdrawConfigV2.cUNI.amount, withdrawConfigV2.cUNI.decimals)]
        ),
      },
      // 12. Transfer withdrawn UNI to recipient
      {
        target: withdrawConfigV2.cUNI.asset,
        signature: 'transfer(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [recipient, exp(withdrawConfigV2.cUNI.amount, withdrawConfigV2.cUNI.decimals)]
        ),
      },
      // 13. Withdraw reserves from cTUSDv2
      {
        target: withdrawConfigV2.cTUSD.address,
        signature: '_reduceReserves(uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['uint256'],
          [exp(withdrawConfigV2.cTUSD.amount, withdrawConfigV2.cTUSD.decimals)]
        ),
      },
      // 14. Transfer withdrawn TUSD to recipient
      {
        target: withdrawConfigV2.cTUSD.asset,
        signature: 'transfer(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [recipient, exp(withdrawConfigV2.cTUSD.amount, withdrawConfigV2.cTUSD.decimals)]
        ),
      },
      // 15. Withdraw reserves from cLINKv2
      {
        target: withdrawConfigV2.cLINK.address,
        signature: '_reduceReserves(uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['uint256'],
          [exp(withdrawConfigV2.cLINK.amount, withdrawConfigV2.cLINK.decimals)]
        ),
      },
      // 16. Transfer withdrawn LINK to recipient
      {
        target: withdrawConfigV2.cLINK.asset,
        signature: 'transfer(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [recipient, exp(withdrawConfigV2.cLINK.amount, withdrawConfigV2.cLINK.decimals)]
        ),
      },
      // 17. Withdraw reserves from cAAVEv2
      {
        target: withdrawConfigV2.cAAVE.address,
        signature: '_reduceReserves(uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['uint256'],
          [exp(withdrawConfigV2.cAAVE.amount, withdrawConfigV2.cAAVE.decimals)]
        ),
      },
      // 18. Transfer withdrawn AAVE to recipient
      {
        target: withdrawConfigV2.cAAVE.asset,
        signature: 'transfer(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [recipient, exp(withdrawConfigV2.cAAVE.amount, withdrawConfigV2.cAAVE.decimals)]
        ),
      },
      // 19. Withdraw reserves from cCOMPv2
      {
        target: withdrawConfigV2.cCOMP.address,
        signature: '_reduceReserves(uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['uint256'],
          [exp(withdrawConfigV2.cCOMP.amount, withdrawConfigV2.cCOMP.decimals)]
        ),
      },
      // 20. Transfer withdrawn COMP to recipient
      {
        target: withdrawConfigV2.cCOMP.asset,
        signature: 'transfer(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [recipient, exp(withdrawConfigV2.cCOMP.amount, withdrawConfigV2.cCOMP.decimals)]
        ),
      },
      // 21. Withdraw reserves from cUSDCv3
      {
        target: withdrawConfigV3.cUSDCv3.address,
        signature: 'withdrawReserves(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [recipient, exp(withdrawConfigV3.cUSDCv3.amount, withdrawConfigV3.cUSDCv3.decimals)]
        ),
      },
      // 22. Withdraw reserves from cWBTCv3
      {
        target: withdrawConfigV3.cWBTCv3.address,
        signature: 'withdrawReserves(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [recipient, exp(withdrawConfigV3.cWBTCv3.amount, withdrawConfigV3.cWBTCv3.decimals)]
        ),
      },
    ];

    const WBTC = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cWBTC2.asset);
    const USDC = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cUSDC.asset);
    const USDT = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cUSDT.asset);
    const BAT = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cBAT.asset);
    const UNI = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cUNI.asset);
    const TUSD = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cTUSD.asset);
    const LINK = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cLINK.asset);
    const AAVE = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cAAVE.asset);
    const COMP = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cCOMP.asset);

    balancesBefore = {
      WBTC: await WBTC.balanceOf(recipient),
      USDC: await USDC.balanceOf(recipient),
      USDT: await USDT.balanceOf(recipient),
      BAT: await BAT.balanceOf(recipient),
      UNI: await UNI.balanceOf(recipient),
      TUSD: await TUSD.balanceOf(recipient),
      LINK: await LINK.balanceOf(recipient),
      AAVE: await AAVE.balanceOf(recipient),
      COMP: await COMP.balanceOf(recipient),
      ETH: BigNumber.from(await deploymentManager.hre.ethers.provider.getBalance(recipient)),
    };

    const description = `DESCRIPTION`;
    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      ), 0, 600_000
    );

    const event = txn.events.find(
      (event: { event: string }) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const WBTC = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cWBTC2.asset);
    const USDC = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cUSDC.asset);
    const USDT = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cUSDT.asset);
    const BAT = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cBAT.asset);
    const UNI = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cUNI.asset);
    const TUSD = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cTUSD.asset);
    const LINK = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cLINK.asset);
    const AAVE = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cAAVE.asset);
    const COMP = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cCOMP.asset);

    const balancesAfter = {
      WBTC: await WBTC.balanceOf(recipient),
      USDC: await USDC.balanceOf(recipient),
      USDT: await USDT.balanceOf(recipient),
      BAT: await BAT.balanceOf(recipient),
      UNI: await UNI.balanceOf(recipient),
      TUSD: await TUSD.balanceOf(recipient),
      LINK: await LINK.balanceOf(recipient),
      AAVE: await AAVE.balanceOf(recipient),
      COMP: await COMP.balanceOf(recipient),
      ETH: BigNumber.from(await deploymentManager.hre.ethers.provider.getBalance(recipient)),
    };

    expect(balancesAfter.WBTC.sub(balancesBefore.WBTC)).to.equal(exp(withdrawConfigV2.cWBTC2.amount, withdrawConfigV2.cWBTC2.decimals) + exp(withdrawConfigV3.cWBTCv3.amount, withdrawConfigV3.cWBTCv3.decimals));
    expect(balancesAfter.USDC.sub(balancesBefore.USDC)).to.equal(exp(withdrawConfigV2.cUSDC.amount, withdrawConfigV2.cUSDC.decimals) + exp(withdrawConfigV3.cUSDCv3.amount, withdrawConfigV3.cUSDCv3.decimals));
    expect(balancesAfter.USDT.sub(balancesBefore.USDT)).to.equal(exp(withdrawConfigV2.cUSDT.amount, withdrawConfigV2.cUSDT.decimals));
    expect(balancesAfter.BAT.sub(balancesBefore.BAT)).to.equal(exp(withdrawConfigV2.cBAT.amount, withdrawConfigV2.cBAT.decimals));
    expect(balancesAfter.UNI.sub(balancesBefore.UNI)).to.equal(exp(withdrawConfigV2.cUNI.amount, withdrawConfigV2.cUNI.decimals));
    expect(balancesAfter.TUSD.sub(balancesBefore.TUSD)).to.equal(exp(withdrawConfigV2.cTUSD.amount, withdrawConfigV2.cTUSD.decimals));
    expect(balancesAfter.LINK.sub(balancesBefore.LINK)).to.equal(exp(withdrawConfigV2.cLINK.amount, withdrawConfigV2.cLINK.decimals));
    expect(balancesAfter.AAVE.sub(balancesBefore.AAVE)).to.equal(exp(withdrawConfigV2.cAAVE.amount, withdrawConfigV2.cAAVE.decimals));
    expect(balancesAfter.COMP.sub(balancesBefore.COMP)).to.equal(exp(withdrawConfigV2.cCOMP.amount, withdrawConfigV2.cCOMP.decimals));
    expect(balancesAfter.ETH.sub(balancesBefore.ETH)).to.equal(exp(withdrawConfigV2.cETH.amount, withdrawConfigV2.cETH.decimals));
  },
});
