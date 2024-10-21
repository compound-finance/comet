// SPDX-License-Identifier: MIT
pragma solidity ^0.8.15;

import "./MarketUpdateContractsDeployer.sol";
import "./MarketAddresses.sol";
import "./ChainAddresses.sol";

library MarketUpdateAddresses {
    address public constant GOVERNOR_BRAVO_PROXY_ADDRESS = 0xc0Da02939E1441F497fd74F78cE7Decb17B66529; // See - https://etherscan.io/address/0xc0Da02939E1441F497fd74F78cE7Decb17B66529
    address public constant GOVERNOR_BRAVO_TIMELOCK_ADDRESS = 0x6d903f6003cca6255D85CcA4D3B5E5146dC33925; // See - https://etherscan.io/address/0x6d903f6003cca6255D85CcA4D3B5E5146dC33925

    // Old Addresses
    address public constant MARKET_ADMIN_PAUSE_GUARDIAN_ADDRESS = 0x7053e25f7076F4986D632A3C04313C81831e0d55;
    address public constant MARKET_UPDATE_PROPOSAL_GUARDIAN_ADDRESS = 0x77B65c68E52C31eb844fb3b4864B91133e2C1308;

    // New Addresses
    address public constant MARKET_UPDATE_MULTISIG_ADDRESS = 0x7053e25f7076F4986D632A3C04313C81831e0d55;

    struct MarketUpdateAddressesStruct {
        // Old addresses
        address governorTimelockAddress;
        address configuratorProxyAddress;
        address cometProxyAdminAddress;
        MarketAddresses.MarketInfo[] markets;

        // New addresses
        address marketUpdateMultiSigAddress;
        address marketAdminProposerAddress;
        address marketUpdateTimelockAddress;
        address marketAdminPermissionCheckerAddress;
        address configuratorImplementationAddress;
        address newCometProxyAdminAddress;
    }


    function getAddressesForChain(
        ChainAddresses.Chain chain,
        MarketUpdateContractsDeployer.DeployedContracts memory deployedContracts,
        address marketUpdateMultisig
    ) public pure returns (MarketUpdateAddressesStruct memory) {
        ChainAddresses.ChainAddressesStruct memory chainAddresses = ChainAddresses.getChainAddresses(chain);
        MarketAddresses.MarketInfo[] memory markets = MarketAddresses.getMarketsForChain(chain);

        return MarketUpdateAddressesStruct({
            governorTimelockAddress: chainAddresses.governorTimelockAddress,
            configuratorProxyAddress: chainAddresses.configuratorProxyAddress,
            cometProxyAdminAddress: chainAddresses.cometProxyAdminAddress,
            markets: markets,
            marketUpdateMultiSigAddress: marketUpdateMultisig,
            marketAdminProposerAddress: deployedContracts.marketUpdateProposer,
            marketUpdateTimelockAddress: deployedContracts.marketUpdateTimelock,
            marketAdminPermissionCheckerAddress: deployedContracts.marketAdminPermissionChecker,
            configuratorImplementationAddress: deployedContracts.newConfiguratorImplementation,
            newCometProxyAdminAddress: deployedContracts.newCometProxyAdmin
        });
    }
}
