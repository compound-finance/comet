import { expect } from 'chai';
import { Contract } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const USDC_COMET = '0xc3d688B66703497DAA19211EEdff47f25384cdc3';
const USDS_COMET = '0x5D409e56D886231aDAf00c8775665AD0f9897b56';
const USDT_COMET = '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840';

const COMET_FACTORY_V2 = '0x298aC0E463cEAd4aaA73fb91Df7C639A8eFBd9c4';

const USDC_EXT = '0xdaBeB59FC033a8dD37A115909F7a007A5b32f0AC';
const USDT_EXT = '0xf9C05b867cFb7A0C8165a6cf90e5c37545BBe774';
const USDS_EXT = '0xeB94c962B30287aCa15608dcD7165729d9d29221';

export default migration('1780051404_update_usd_based_to_v2_factory', {
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
      // 1. Update USDC Comet factory to a new one
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [USDC_COMET, COMET_FACTORY_V2],
      },
      // 2. Set service patch version of the extension delegate for the USDC Comet
      {
        contract: configurator,
        signature: 'setExtensionDelegate(address,address)',
        args: [USDC_COMET, USDC_EXT],
      },
      // 3. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, USDC_COMET],
      },
      // 4. Update USDT Comet factory to the new one
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [USDT_COMET, COMET_FACTORY_V2],
      },
      // 5. Set service patch version of the extension delegate for the USDT Comet
      {
        contract: configurator,
        signature: 'setExtensionDelegate(address,address)',
        args: [USDT_COMET, USDT_EXT],
      },
      // 6. Deploy and upgrade USDT Comet to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, USDT_COMET],
      },
      // 7. Update USDS Comet factory to the new one
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [USDS_COMET, COMET_FACTORY_V2],
      },
      // 8. Set service patch version of the extension delegate for the USDS Comet
      {
        contract: configurator,
        signature: 'setExtensionDelegate(address,address)',
        args: [USDS_COMET, USDS_EXT],
      },
      // 9. Deploy and upgrade USDS Comet to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, USDS_COMET],
      },
    ];

    const description = `# Update Mainnet USD based Comets to the service patch version

## Proposal summary

WOOF! proposes to update Mainnet cUSDCv3, cUSDTv3 and cUSDSv3 Comet markets to a new service patch version introducing several improvements and security enhancements:

- Extended Pause Controls: collateral interactions can now be paused independently per collateral asset.
- Price Feed Patch (Post-USDM incident response): skips price feed calls for assets with zero collateral factor, preventing unnecessary reverts.
- Collateral Deactivation Mechanism: introduces a Guardian-controlled emergency mechanism to deactivate unsafe collateral assets, with reactivation requiring a governance proposal.
- Utilization Peaking Protection: caps utilization at 200%, preventing additional borrowing when post-borrow utilization exceeds this threshold, while preserving lender withdrawals.
- Borrow Index Fix (Empty Market): prevents borrow interest accrual in markets without active borrowers.
- Supply Index Fix (Empty Market): ensures supply index only accrues when lenders are present.
- Lender Illiquidity Fix in Zero-Borrow Markets: prevents reserve depletion in markets with no borrowers by capping supply rate to zero when utilization is zero and reserves are exhausted.
- Accrue Interest on Collateral Actions (Post-USDM incident response): collateral actions (supply, withdraw, transfer) now trigger interest accrual for affected accounts.
- Technical Improvements: includes removal of redundant arguments in supplyInternal() and optimized price caching in absorbInternal(), improving gas efficiency without affecting protocol behavior.

This proposal takes the governance steps recommended and necessary to update Compound III USDS, USDT and USDS markets on Mainnet. Simulations have confirmed the market's readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario).

Detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1125).

### Bytecode Repository

This update is done with the use of the bytecode repository, which provides trustless and deterministic deployments.

Further details on the deployment can be found in the [Bytecode Repository git](https://github.com/woof-software/bytecode-repository) and [forum discussion](https://www.comp.xyz/t/rfc-bytecode-repository-and-deployment-pipeline-modernization/6965).

### Audit

Both service patch Comet update and Bytecode Repository have been audited by Certora and full reports can be found here:

- [Certora Comet Service Patch Audit](https://www.certora.com/reports/comet-service-patch)
- [Certora Bytecode Repository Audit](https://www.certora.com/reports/compound-bytecoderepository)


## Proposal Actions

The first proposal action updates the factory of the USDC Comet to the new V2 factory.

The second proposal action sets the extension delegate for the USDC Comet to the new service patch version.

The third proposal action deploys and upgrades the USDC Comet to the new service patch version.

The fourth proposal action updates the factory of the USDT Comet to the new V2 factory.

The fifth proposal action sets the extension delegate for the USDT Comet to the new service patch version.

The sixth proposal action deploys and upgrades the USDT Comet to the new service patch version.

The seventh proposal action updates the factory of the USDS Comet to the new V2 factory.

The eighth proposal action sets the extension delegate for the USDS Comet to the new service patch version.

The ninth proposal action deploys and upgrades the USDS Comet to the new service patch version.
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
    const newCometAbi = [
      'function MAX_SUPPORTED_UTILIZATION() external view returns (uint256)',
      'function symbol() external view returns (string)',
      'function name() external view returns (string)',
      'function extensionDelegate() external view returns (address)',
    ];

    expect(await configurator.factory(USDC_COMET)).to.equal(COMET_FACTORY_V2);
    expect(await configurator.factory(USDT_COMET)).to.equal(COMET_FACTORY_V2);
    expect(await configurator.factory(USDS_COMET)).to.equal(COMET_FACTORY_V2);

    expect((await configurator.getConfiguration(USDC_COMET)).extensionDelegate).to.equal(USDC_EXT);
    expect((await configurator.getConfiguration(USDT_COMET)).extensionDelegate).to.equal(USDT_EXT);
    expect((await configurator.getConfiguration(USDS_COMET)).extensionDelegate).to.equal(USDS_EXT);

    const expectedMaxUtilization = exp(2, 18);
    const signer = await deploymentManager.getSigner();

    const newCometUsdc = new Contract(USDC_COMET, newCometAbi, signer);

    expect(await newCometUsdc.MAX_SUPPORTED_UTILIZATION()).to.equal(expectedMaxUtilization);
    expect(await newCometUsdc.symbol()).to.equal('cUSDCv3');
    expect(await newCometUsdc.name()).to.equal('Compound USDC');
    expect(await newCometUsdc.extensionDelegate()).to.equal(USDC_EXT);

    const newCometUsdt = new Contract(USDT_COMET, newCometAbi, signer);

    expect(await newCometUsdt.MAX_SUPPORTED_UTILIZATION()).to.equal(expectedMaxUtilization);
    expect(await newCometUsdt.symbol()).to.equal('cUSDTv3');
    expect(await newCometUsdt.name()).to.equal('Compound USDT');
    expect(await newCometUsdt.extensionDelegate()).to.equal(USDT_EXT);

    const newCometUsds = new Contract(USDS_COMET, newCometAbi, signer);

    expect(await newCometUsds.MAX_SUPPORTED_UTILIZATION()).to.equal(expectedMaxUtilization);
    expect(await newCometUsds.symbol()).to.equal('cUSDSv3');
    expect(await newCometUsds.name()).to.equal('Compound USDS');
    expect(await newCometUsds.extensionDelegate()).to.equal(USDS_EXT);
  },
});
