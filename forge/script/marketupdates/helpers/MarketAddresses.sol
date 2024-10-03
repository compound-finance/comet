// SPDX-License-Identifier: MIT
pragma solidity ^0.8.15;

import "./ChainAddresses.sol";

library MarketAddresses {

    struct MarketInfo {
        string baseTokenSymbol;
        address cometProxyAddress;
    }


    address constant public MAINNET_USDC_MARKET = 0xc3d688B66703497DAA19211EEdff47f25384cdc3; // See - https://etherscan.io/address/0xc3d688B66703497DAA19211EEdff47f25384cdc3
    address constant public MAINNET_USDT_MARKET = 0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840; // See - https://etherscan.io/address/0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840
    address constant public MAINNET_ETH_MARKET = 0xA17581A9E3356d9A858b789D68B4d866e593aE94; // See - https://etherscan.io/address/0xA17581A9E3356d9A858b789D68B4d866e593aE94
    address constant public MAINNET_WST_ETH_MARKET = 0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3; // See - https://etherscan.io/address/0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3

    address constant public POLYGON_USDCe_MARKET = 0xF25212E676D1F7F89Cd72fFEe66158f541246445; // See - https://polygonscan.com/address/0xF25212E676D1F7F89Cd72fFEe66158f541246445
    address constant public POLYGON_USDT_MARKET = 0xaeB318360f27748Acb200CE616E389A6C9409a07; // See - https://polygonscan.com/address/0xaeB318360f27748Acb200CE616E389A6C9409a07
    
    address constant public ARBITRUM_USDCe_MARKET = 0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA; // See - https://arbiscan.io/address/0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA
    address constant public ARBITRUM_USDC_MARKET = 0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf; // See - https://arbiscan.io/address/0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf
    address constant public ARBITRUM_USDT_MARKET = 0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07; // See - https://arbiscan.io/address/0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07
    address constant public ARBITRUM_ETH_MARKET = 0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486; // See - https://arbiscan.io/address/0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486

    address constant public BASE_USDC_MARKET = 0xb125E6687d4313864e53df431d5425969c15Eb2F; // See - https://basescan.org/address/0xb125E6687d4313864e53df431d5425969c15Eb2F
    address constant public BASE_USDbC_MARKET = 0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf;  // See - https://basescan.org/address/0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf
    address constant public BASE_ETH_MARKET = 0x46e6b214b524310239732D51387075E0e70970bf; // See - https://basescan.org/address/0x46e6b214b524310239732D51387075E0e70970bf

    address constant public SCROLL_USDC_MARKET = 0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44; // See - https://scrollscan.com/address/0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44

    address constant public OPTIMISM_USDC_MARKET = 0x2e44e174f7D53F0212823acC11C01A11d58c5bCB; // See - https://optimistic.etherscan.io/address/0x2e44e174f7D53F0212823acC11C01A11d58c5bCB
    address constant public OPTIMISM_USDT_MARKET = 0x995E394b8B2437aC8Ce61Ee0bC610D617962B214; // See - https://optimistic.etherscan.io/address/0x995E394b8B2437aC8Ce61Ee0bC610D617962B214
    address constant public OPTIMISM_ETH_MARKET = 0xE36A30D249f7761327fd973001A32010b521b6Fd; // See - https://optimistic.etherscan.io/address/0xE36A30D249f7761327fd973001A32010b521b6Fd

    function getMarketsForChain(ChainAddresses.Chain chain) internal pure returns (MarketInfo[] memory) {
        if (chain == ChainAddresses.Chain.ETHEREUM) {
            MarketInfo[] memory markets = new MarketInfo[](4);
            markets[0] = MarketInfo({
                baseTokenSymbol: "ETH",
                cometProxyAddress: MAINNET_ETH_MARKET
            });
            markets[1] = MarketInfo({
                baseTokenSymbol: "USDC",
                cometProxyAddress: MAINNET_USDC_MARKET
            });
            markets[2] = MarketInfo({
                baseTokenSymbol: "USDT",
                cometProxyAddress: MAINNET_USDT_MARKET
            });
            markets[3] = MarketInfo({
                baseTokenSymbol: "wstETH",
                cometProxyAddress: MAINNET_WST_ETH_MARKET
            });
            return markets;
        } else if (chain == ChainAddresses.Chain.POLYGON) {
            MarketInfo[] memory markets = new MarketInfo[](2);
            markets[0] = MarketInfo({
                baseTokenSymbol: "USDC.e",
                cometProxyAddress: POLYGON_USDCe_MARKET
            });
            markets[1] = MarketInfo({
                baseTokenSymbol: "USDT",
                cometProxyAddress: POLYGON_USDT_MARKET
            });
            return markets;
        } else if (chain == ChainAddresses.Chain.ARBITRUM) {
            MarketInfo[] memory markets = new MarketInfo[](4);
            markets[0] = MarketInfo({
                baseTokenSymbol: "USDC.e",
                cometProxyAddress: ARBITRUM_USDCe_MARKET
            });
            markets[1] = MarketInfo({
                baseTokenSymbol: "USDC",
                cometProxyAddress: ARBITRUM_USDC_MARKET
            });
            markets[2] = MarketInfo({
                baseTokenSymbol: "ETH",
                cometProxyAddress: ARBITRUM_ETH_MARKET
            });
            markets[3] = MarketInfo({
                baseTokenSymbol: "USDT",
                cometProxyAddress: ARBITRUM_USDT_MARKET
            });
            return markets;
        } else if (chain == ChainAddresses.Chain.BASE) {
            MarketInfo[] memory markets = new MarketInfo[](3);
            markets[0] = MarketInfo({
                baseTokenSymbol: "USDC",
                cometProxyAddress: BASE_USDC_MARKET
            });
            markets[1] = MarketInfo({
                baseTokenSymbol: "USDbC",
                cometProxyAddress: BASE_USDbC_MARKET
            });
            markets[2] = MarketInfo({
                baseTokenSymbol: "ETH",
                cometProxyAddress: BASE_ETH_MARKET
            });
            return markets;
        } else if (chain == ChainAddresses.Chain.SCROLL) {
            MarketInfo[] memory markets = new MarketInfo[](1);
            markets[0] = MarketInfo({
                baseTokenSymbol: "USDC",
                cometProxyAddress: SCROLL_USDC_MARKET
            });
            return markets;
        } else if (chain == ChainAddresses.Chain.OPTIMISM) {
            MarketInfo[] memory markets = new MarketInfo[](3);
            markets[0] = MarketInfo({
                baseTokenSymbol: "USDC",
                cometProxyAddress: OPTIMISM_USDC_MARKET
            });
            markets[1] = MarketInfo({
                baseTokenSymbol: "USDT",
                cometProxyAddress: OPTIMISM_USDT_MARKET
            });
            markets[2] = MarketInfo({
                baseTokenSymbol: "ETH",
                cometProxyAddress: OPTIMISM_ETH_MARKET
            });
            return markets;
        }

        revert("MarketUpdateAddresses: Chain not supported");
    }

}
