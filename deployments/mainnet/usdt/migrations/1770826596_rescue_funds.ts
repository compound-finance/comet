import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { BigNumber } from 'ethers';

const amountOfAccidentalTransfers = exp(19_958.414155, 6);

const USER_ADDRESS = '0xF27696C8BCa7D54D696189085Ae1283f59342fA6';

let balanceBefore: BigNumber;

export default migration('1770826596_rescue_funds', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {
    const trace = deploymentManager.tracer();

    const {
      governor,
      comet,
      USDT
    } = await deploymentManager.getContracts();

    const mainnetActions = [
      // 1. Add tBTC as asset
      {
        contract: comet,
        signature: 'withdrawReserves(address,uint256)',
        args: [USER_ADDRESS, amountOfAccidentalTransfers],
      },
    ];

    const description = `# Return accidentally send funds

## Proposal summary

This proposal returns accidentally sended funds to a cUSDTv3 on Mainnet. Funds will be sent back to the user.

Further detailed information can be found on the corresponding [forum discussion](https://www.comp.xyz/t/woof-correlated-assets-price-oracle-capo/6245).

Accidental transfer tx hash: 0x92b03289ad09323ec897e106442096f3fc07f4c9cee4e02add7ee2b672d865e3
Amount sent: 19_958.414155
User address: 0xF27696C8BCa7D54D696189085Ae1283f59342fA6

## Proposal actions

The first action withdraws accidentally sent funds from a comet and transfers them back to the user.
`;
    balanceBefore = await USDT.balanceOf(USER_ADDRESS);
    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      ), 0, 300_000
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
    const { USDT } = await deploymentManager.getContracts();

    expect(balanceBefore.add(amountOfAccidentalTransfers)).to.equal(await USDT.balanceOf(USER_ADDRESS));
  },
});
