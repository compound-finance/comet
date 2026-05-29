import { expect } from 'chai';
import { Contract } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const WETH_COMET = '0xA17581A9E3356d9A858b789D68B4d866e593aE94';
const WBTC_COMET = '0xe85Dc543813B8c2CFEaAc371517b925a166a9293';
const WSTETH_COMET = '0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3';

const COMET_FACTORY_V2 = '0x219E8039359C1ED650c7280bA87251E282288f7F';

const WETH_EXT = '0x970325D751a57E73f403043Db3239b8E7AFe69A0';
const WBTC_EXT = '0x639dd5d4C8Ce13e1F9c4B906843731C10DC6536a';
const WSTETH_EXT = '0x476C39817f6a68c306EE55E38595E1584C507249';

export default migration('1779290648_update_non_usd_based_to_v2_factory', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {

    const trace = deploymentManager.tracer();

    const {
      governor,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const mainnetActions = [
      // 1. Update WETH Comet factory to a new one
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [WETH_COMET, COMET_FACTORY_V2],
      },
      // 2. Set service patch version of the extension delegate for the WETH Comet
      {
        contract: configurator,
        signature: 'setExtensionDelegate(address,address)',
        args: [WETH_COMET, WETH_EXT],
      },
      // 3. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, WETH_COMET],
      },
      // 4. Update WBTC Comet factory to the new one
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [WBTC_COMET, COMET_FACTORY_V2],
      },
      // 5. Set service patch version of the extension delegate for the WBTC Comet
      {
        contract: configurator,
        signature: 'setExtensionDelegate(address,address)',
        args: [WBTC_COMET, WBTC_EXT],
      },
      // 6. Deploy and upgrade WBTC Comet to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, WBTC_COMET],
      },
      // 7. Update wstETH Comet factory to the new one
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [WSTETH_COMET, COMET_FACTORY_V2],
      },
      // 8. Set service patch version of the extension delegate for the wstETH Comet
      {
        contract: configurator,
        signature: 'setExtensionDelegate(address,address)',
        args: [WSTETH_COMET, WSTETH_EXT],
      },
      // 9. Deploy and upgrade wstETH Comet to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, WSTETH_COMET],
      },
    ];

    const description = `# Update Mainnet non-USD based Comets to the service patch version

## Proposal summary

WOOF! proposes to update Mainnet cWETHv3, cWBTCv3 and cwstETHv3 Comet markets to a new service patch version introducing several improvements and security enhancements:

- Extended Pause Controls: collateral interactions can now be paused independently per collateral asset.
- Price Feed Patch (Post-USDM incident response): skips price feed calls for assets with zero collateral factor, preventing unnecessary reverts.
- Collateral Deactivation Mechanism: introduces a Guardian-controlled emergency mechanism to deactivate unsafe collateral assets, with reactivation requiring a governance proposal.
- Utilization Peaking Protection: caps utilization at 200%, preventing additional borrowing when post-borrow utilization exceeds this threshold, while preserving lender withdrawals.
- Borrow Index Fix (Empty Market): prevents borrow interest accrual in markets without active borrowers.
- Supply Index Fix (Empty Market): ensures supply index only accrues when lenders are present.
- Lender Illiquidity Fix in Zero-Borrow Markets: prevents reserve depletion in markets with no borrowers by capping supply rate to zero when utilization is zero and reserves are exhausted.
- Accrue Interest on Collateral Actions (Post-USDM incident response): collateral actions (supply, withdraw, transfer) now trigger interest accrual for affected accounts.
- Technical Improvements: includes removal of redundant arguments in supplyInternal() and optimized price caching in absorbInternal(), improving gas efficiency without affecting protocol behavior.

This proposal takes the governance steps recommended and necessary to update Compound III WETH, WBTC and wstETH markets on Mainnet. Simulations have confirmed the market's readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario).

Detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1128).

### Bytecode Repository

This update is done with the use of the bytecode repository, which provides trustless and deterministic deployments.

Further details on the deployment can be found in the [Bytecode Repository git](https://github.com/woof-software/bytecode-repository) and [forum discussion](https://www.comp.xyz/t/rfc-bytecode-repository-and-deployment-pipeline-modernization/6965).

### Audit

Both service patch Comet update and Bytecode Repository have been audited by Certora and full reports can be found here:

- [Certora Comet Service Patch Audit](https://www.certora.com/reports/comet-service-patch)
- [Certora Bytecode Repository Audit](https://www.certora.com/reports/compound-bytecoderepository)


## Proposal Actions

The first proposal action updates the factory of the WETH Comet to the new V2 factory.

The second proposal action sets the extension delegate for the WETH Comet to the new service patch version.

The third proposal action deploys and upgrades the WETH Comet to the new service patch version.

The fourth proposal action updates the factory of the WBTC Comet to the new V2 factory.

The fifth proposal action sets the extension delegate for the WBTC Comet to the new service patch version.

The sixth proposal action deploys and upgrades the WBTC Comet to the new service patch version.

The seventh proposal action updates the factory of the wstETH Comet to the new V2 factory.

The eighth proposal action sets the extension delegate for the wstETH Comet to the new service patch version.

The ninth proposal action deploys and upgrades the wstETH Comet to the new service patch version.
`;
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
    const { configurator } = await deploymentManager.getContracts();

    expect(await configurator.factory(WETH_COMET)).to.equal(COMET_FACTORY_V2);
    expect(await configurator.factory(WBTC_COMET)).to.equal(COMET_FACTORY_V2);
    expect(await configurator.factory(WSTETH_COMET)).to.equal(COMET_FACTORY_V2);

    expect((await configurator.getConfiguration(WETH_COMET)).extensionDelegate).to.equal(WETH_EXT);
    expect((await configurator.getConfiguration(WBTC_COMET)).extensionDelegate).to.equal(WBTC_EXT);
    expect((await configurator.getConfiguration(WSTETH_COMET)).extensionDelegate).to.equal(WSTETH_EXT);

    const expectedMaxUtilization = exp(2, 18);
    const signer = await deploymentManager.getSigner();

    const newCometWeth = new Contract(
      WETH_COMET,
      [
        'function MAX_SUPPORTED_UTILIZATION() external view returns (uint256)',
        'function symbol() external view returns (string)',
        'function name() external view returns (string)',
        'function extensionDelegate() external view returns (address)',
      ],
      signer
    );

    expect(await newCometWeth.MAX_SUPPORTED_UTILIZATION()).to.equal(expectedMaxUtilization);
    expect(await newCometWeth.symbol()).to.equal('cWETHv3');
    expect(await newCometWeth.name()).to.equal('Compound WETH');
    expect(await newCometWeth.extensionDelegate()).to.equal(WETH_EXT);

    const newCometWbtc = new Contract(
      WBTC_COMET,
      [
        'function MAX_SUPPORTED_UTILIZATION() external view returns (uint256)',
        'function symbol() external view returns (string)',
        'function name() external view returns (string)',
        'function extensionDelegate() external view returns (address)',
      ],
      signer
    );

    expect(await newCometWbtc.MAX_SUPPORTED_UTILIZATION()).to.equal(expectedMaxUtilization);
    expect(await newCometWbtc.symbol()).to.equal('cWBTCv3');
    expect(await newCometWbtc.name()).to.equal('Compound WBTC');
    expect(await newCometWbtc.extensionDelegate()).to.equal(WBTC_EXT);

    const newCometWsteth = new Contract(
      WSTETH_COMET,
      [
        'function MAX_SUPPORTED_UTILIZATION() external view returns (uint256)',
        'function symbol() external view returns (string)',
        'function name() external view returns (string)',
        'function extensionDelegate() external view returns (address)',
      ],
      signer
    );

    expect(await newCometWsteth.MAX_SUPPORTED_UTILIZATION()).to.equal(expectedMaxUtilization);
    expect(await newCometWsteth.symbol()).to.equal('cWstETHv3');
    expect(await newCometWsteth.name()).to.equal('Compound wstETH');
    expect(await newCometWsteth.extensionDelegate()).to.equal(WSTETH_EXT);
  },
});
