# Deployment
Assuming contracts are deployed using forge scripts, we want to write a migration for creating a proposal
for market updates. 

So in the migration, we can call a helper contract which has functions to prepare a proposal. We can see ho to 
avoid the initialization of that contract, as in really we just need to call a library which returns the information 
needed for creating the proposal.

# Proposals for L2
Proposals for l2 has two parts 
### 1) Preparation
Preparation involves deploying of the contracts. Here we can just deploy the contracts using the forge scripts.

Robin with connect with Compound team on Monday to take a decision on this.


### 2) Proposal creation
Proposal creation involves two parts

##### 1) Create L2 payload
Creating the payload of the actions that needs to be taken by local timelock of L2. The payload is
`abi.encode(targets, values, signatures, calldatas)`. We have the code to get the targets, values, signatures, calldatas
i.e.

```solidity
  
// This gets all the chain and market specific addresses.
MarketUpdateAddresses.MarketUpdateAddressesStruct memory addresses = MarketUpdateAddresses.getAddressesForChain(
   chain,
   deployedContracts,
   MarketUpdateAddresses.MARKET_UPDATE_MULTISIG_ADDRESS
);


// This gets the payload for the proposal
GovernanceHelper.ProposalRequest memory proposalRequest = GovernanceHelper.createDeploymentProposalRequest(addresses);
```

Here DeployedAddresses has the addresses of all the deployed contracts and ProposalRequest has the targets, values, signatures, calldatas.
```solidity
struct DeployedContracts {
   address marketUpdateTimelock;
   address marketUpdateProposer;
   address newCometProxyAdmin;
   address newConfiguratorImplementation;
   address marketAdminPermissionChecker;
}


struct ProposalRequest {
   address[] targets;
   uint256[] values;
   string[] signatures;
   bytes[] calldatas;
}
```
We can either encode in solidity or in the migration script.

If we look at an existing migration script i.g. `deployments/optimism/usdc/migrations/1721299083_add_wsteth_as_collateral.ts`
We see this part implemented in typescipt
```typescript
const newAssetConfig = {
   asset: wstETH.address,
   priceFeed: wstETHPricefeed.address,
   decimals: await wstETH.decimals(),
   borrowCollateralFactor: exp(0.80, 18),
   liquidateCollateralFactor: exp(0.85, 18),
   liquidationFactor: exp(0.90, 18),
   supplyCap: exp(600, 18),
};

newPriceFeedAddress = wstETHPricefeed.address;

const addAssetCalldata = await calldata(
        configurator.populateTransaction.addAsset(comet.address, newAssetConfig)
);
const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
        ['address', 'address'],
        [configurator.address, comet.address]
);

const l2ProposalData = utils.defaultAbiCoder.encode(
        ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
        [
           [configurator.address, cometAdmin.address],
           [0, 0],
           [
              'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
              'deployAndUpgradeTo(address,address)',
           ],
           [addAssetCalldata, deployAndUpgradeToCalldata],
        ]
);
```
##### 2) Creating Mainnet Proposal
For this we plan to use existing migrations as they have the code related to calling of the bridge and for doing 
it in a forge script, we have to do quite some unit testing. So we plan to use the existing migrations.

See this code
```typescript
const mainnetActions = [
   // Send the proposal to the L2 bridge
   {
      contract: opL1CrossDomainMessenger,
      signature: 'sendMessage(address,bytes,uint32)',
      args: [bridgeReceiver.address, l2ProposalData, 3_000_000]
   },
];

const description = '# Add wstETH as collateral into cUSDCv3 on Optimism\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add wstETH into cUSDCv3 on Optimism network. This proposal takes the governance steps recommended and necessary to update a Compound III USDC market on Optimism. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/gauntlet-wsteth-listing-for-usdc-and-usdt-comet-on-optimism/5441/1).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/892) and [forum discussion](https://www.comp.xyz/t/gauntlet-wsteth-listing-for-usdc-and-usdt-comet-on-optimism/5441).\n\n\n## Proposal Actions\n\nThe first proposal action adds wstETH to the USDC Comet on Optimism. This sends the encoded `addAsset` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Optimism.';
const txn = await govDeploymentManager.retry(async () =>
        trace(
                await governor.propose(...(await proposal(mainnetActions, description)))
        )
);

const event = txn.events.find(
        (event) => event.event === 'ProposalCreated'
);
const [proposalId] = event.args;
trace(`Created proposal ${proposalId}.`);

```

# Our Deployment Plan
- We plan to deploy the contracts using the forge scripts. Alternatively we can create a `Deployer(Helper)` or 
deploy all the contracts in the prepare function of the migration.
- We plan to create the payload in the migration script.

# Checklist
- [ ] See what are our options for calling the libraries in the migration script. If
we can call the libraries in the migration script, we can a lot of the extra typescript code.
- [ ] Check pauseGuardian, multisig, and proposalGuardian are set properly
