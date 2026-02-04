// SPDX-License-Identifier: MIT
pragma solidity ^0.8.15;

library ChainAddresses {

    struct ChainAddressesStruct {
        address governorTimelockAddress;
        address configuratorProxyAddress;
        address cometProxyAdminAddress;
        address marketUpdatePauseGuardian;
        address marketUpdateProposalGuardian;
        address marketAdmin;
    }

    enum Chain {
        ETHEREUM,
        POLYGON,
        ARBITRUM,
        BASE,
        SCROLL,
        OPTIMISM,
        MAINNET_SEPOLIA,
        LINEA,
        RONIN,
        UNICHAIN,
        MANTLE
    }

    // Mainnet addresses
    address constant public MAINNET_GOVERNOR_TIMELOCK = 0x6d903f6003cca6255D85CcA4D3B5E5146dC33925; // See - https://etherscan.io/address/0x6d903f6003cca6255D85CcA4D3B5E5146dC33925
    address constant public MAINNET_CONFIGURATOR_PROXY = 0x316f9708bB98af7dA9c68C1C3b5e79039cD336E3; // See - https://etherscan.io/address/0x316f9708bB98af7dA9c68C1C3b5e79039cD336E3
    address constant public MAINNET_COMET_PROXY_ADMIN = 0x1EC63B5883C3481134FD50D5DAebc83Ecd2E8779; // See - https://etherscan.io/address/0x1EC63B5883C3481134FD50D5DAebc83Ecd2E8779

    address constant public MAINNET_MARKET_ADMIN = 0xA1C7b6d8b4DeD5ee46330C865cC8aeCfB13c8b65; // See - https://etherscan.io/address/0xA1C7b6d8b4DeD5ee46330C865cC8aeCfB13c8b65
    address constant public MAINNET_MARKET_UPDATE_PAUSE_GUARDIAN = 0xbbf3f1421D886E9b2c5D716B5192aC998af2012c; // See - pauseGuardian in https://etherscan.io/address/0xc3d688B66703497DAA19211EEdff47f25384cdc3#readProxyContract
    address constant public MAINNET_MARKET_UPDATE_PROPOSAL_GUARDIAN = 0xbbf3f1421D886E9b2c5D716B5192aC998af2012c ; // See - https://etherscan.io/address/0xc3d688B66703497DAA19211EEdff47f25384cdc3#readProxyContract

    // Linea addresses
    address constant public LINEA_GOVERNOR_TIMELOCK = 0x4A900f81dEdA753bbBab12453b3775D5f26df6F3; // See - https://lineascan.build/address/0x4A900f81dEdA753bbBab12453b3775D5f26df6F3
    address constant public LINEA_CONFIGURATOR_PROXY = 0x970FfD8E335B8fa4cd5c869c7caC3a90671d5Dc3; // See - https://lineascan.build/address/0x970FfD8E335B8fa4cd5c869c7caC3a90671d5Dc3
    address constant public LINEA_COMET_PROXY_ADMIN = 0x4b5DeE60531a72C1264319Ec6A22678a4D0C8118; // See - https://lineascan.build/address/0x4b5DeE60531a72C1264319Ec6A22678a4D0C8118

    address constant public LINEA_MARKET_ADMIN = 0x7e14050080306cd36b47DE61ce604b3a1EC70c4e; // See - https://lineascan.build/address/0x7e14050080306cd36b47DE61ce604b3a1EC70c4e
    address constant public LINEA_MARKET_UPDATE_PAUSE_GUARDIAN =  0x5A1e5d7E09cA94506084a26304d53A138145bF52; // See - pauseGuardian in https://lineascan.build/address/0x5A1e5d7E09cA94506084a26304d53A138145bF52
    address constant public LINEA_MARKET_UPDATE_PROPOSAL_GUARDIAN =  0x5A1e5d7E09cA94506084a26304d53A138145bF52; // See - https://lineascan.build/address/0x5A1e5d7E09cA94506084a26304d53A138145bF52

    // Ronin addresses
    address constant public RONIN_GOVERNOR_TIMELOCK = 0xBbb0Ebd903fafbb8fFF58B922fD0CD85E251ac2c; // See - https://app.roninchain.com/address/0x6d903f6003cca6255D85CcA4D3B5E5146dC33925
    address constant public RONIN_CONFIGURATOR_PROXY = 0x966c72F456FC248D458784EF3E0b6d042be115F2; // See - https://app.roninchain.com/address/0x316f9708bB98af7dA9c68C1C3b5e79039cD336E3
    address constant public RONIN_COMET_PROXY_ADMIN = 0xfa64A82a3d13D4c05d5133E53b2EbB8A0FA9c3F6; // See - https://app.roninchain.com/address/0x1EC63B5883C3481134FD50D5DAebc83Ecd2E8779

    address constant public RONIN_MARKET_ADMIN = 0x7e14050080306cd36b47DE61ce604b3a1EC70c4e; // See - https://app.roninchain.com/address/0xA1C7b6d8b4DeD5ee46330C865cC8aeCfB13c8b65
    address constant public RONIN_MARKET_UPDATE_PAUSE_GUARDIAN =  0x69daaf2Fb26Cb138D33466808dE917d571151a68; // See - pauseGuardian in https://app.roninchain.com/address/0xc3d688B66703497DAA19211EEdff47f25384cdc3
    address constant public RONIN_MARKET_UPDATE_PROPOSAL_GUARDIAN =  0x69daaf2Fb26Cb138D33466808dE917d571151a68; // See - https://app.roninchain.com/address/0xc3d688B66703497DAA19211EEdff47f25384cdc3

    // Unichain addresses
    address constant public UNICHAIN_GOVERNOR_TIMELOCK = 0x2F4eAF29dfeeF4654bD091F7112926E108eF4Ed0; // See - https://unichain.blockscout.com/address/0x6d903f6003cca6255D85CcA4D3B5E5146dC33925
    address constant public UNICHAIN_CONFIGURATOR_PROXY = 0x8df378453Ff9dEFFa513367CDF9b3B53726303e9; // See - https://unichain.blockscout.com/address/0x316f9708bB98af7dA9c68C1C3b5e79039cD336E3
    address constant public UNICHAIN_COMET_PROXY_ADMIN = 0xaeB318360f27748Acb200CE616E389A6C9409a07; // See - https://unichain.blockscout.com/address/0x1EC63B5883C3481134FD50D5DAebc83Ecd2E8779

    address constant public UNICHAIN_MARKET_ADMIN = 0x7e14050080306cd36b47DE61ce604b3a1EC70c4e; // See - https://unichain.blockscout.com/address/0xA1C7b6d8b4DeD5ee46330C865cC8aeCfB13c8b65
    address constant public UNICHAIN_MARKET_UPDATE_PAUSE_GUARDIAN = 0x6784FC9e931D7d5B1075e665A4016c299ee6C31B; // See - pauseGuardian in https://unichain.blockscout.com/address/0xc3d688B66703497DAA19211EEdff47f25384cdc3
    address constant public UNICHAIN_MARKET_UPDATE_PROPOSAL_GUARDIAN = 0x6784FC9e931D7d5B1075e665A4016c299ee6C31B; // See - https://unichain.blockscout.com/address/0xc3d688B66703497DAA19211EEdff47f25384cdc3

    // Polygon addresses
    address constant public POLYGON_LOCAL_TIMELOCK = 0xCC3E7c85Bb0EE4f09380e041fee95a0caeDD4a02; // See - https://polygonscan.com/address/0xCC3E7c85Bb0EE4f09380e041fee95a0caeDD4a02
    address constant public POLYGON_CONFIGURATOR_PROXY = 0x83E0F742cAcBE66349E3701B171eE2487a26e738; // See - https://polygonscan.com/address/0x83E0F742cAcBE66349E3701B171eE2487a26e738
    address constant public POLYGON_COMET_PROXY_ADMIN = 0xd712ACe4ca490D4F3E92992Ecf3DE12251b975F9; // See - https://polygonscan.com/address/0xd712ACe4ca490D4F3E92992Ecf3DE12251b975F9
    address constant public POLYGON_BRIDGE_RECEIVER = 0x18281dfC4d00905DA1aaA6731414EABa843c468A; // See - https://polygonscan.com/address/0x18281dfC4d00905DA1aaA6731414EABa843c468A

    address constant public POLYGON_MARKET_ADMIN = 0x7e14050080306cd36b47DE61ce604b3a1EC70c4e; // See - https://polygonscan.com/address/0x7e14050080306cd36b47DE61ce604b3a1EC70c4e
    address constant public POLYGON_MARKET_UPDATE_PAUSE_GUARDIAN = 0x8Ab717CAC3CbC4934E63825B88442F5810aAF6e5; // See - pauseGuardian in https://polygonscan.com/address/0x8Ab717CAC3CbC4934E63825B88442F5810aAF6e5
    address constant public POLYGON_MARKET_UPDATE_PROPOSAL_GUARDIAN = 0x8Ab717CAC3CbC4934E63825B88442F5810aAF6e5; // See - https://polygonscan.com/address/0x8Ab717CAC3CbC4934E63825B88442F5810aAF6e5

    // Arbitrum addresses
    address constant public ARBITRUM_LOCAL_TIMELOCK = 0x3fB4d38ea7EC20D91917c09591490Eeda38Cf88A; // See - https://arbiscan.io/address/0x3fB4d38ea7EC20D91917c09591490Eeda38Cf88A
    address constant public ARBITRUM_CONFIGURATOR_PROXY = 0xb21b06D71c75973babdE35b49fFDAc3F82Ad3775; // See - https://arbiscan.io/address/0xb21b06D71c75973babdE35b49fFDAc3F82Ad3775
    address constant public ARBITRUM_COMET_PROXY_ADMIN = 0xD10b40fF1D92e2267D099Da3509253D9Da4D715e; // See - https://arbiscan.io/address/0xD10b40fF1D92e2267D099Da3509253D9Da4D715e
    address constant public ARBITRUM_BRIDGE_RECEIVER = 0x42480C37B249e33aABaf4c22B20235656bd38068; // See - https://arbiscan.io/address/0x42480C37B249e33aABaf4c22B20235656bd38068

    address constant public ARBITRUM_MARKET_ADMIN = 0x7e14050080306cd36b47DE61ce604b3a1EC70c4e; // See - https://arbiscan.io/address/0x7e14050080306cd36b47DE61ce604b3a1EC70c4e
    address constant public ARBITRUM_MARKET_UPDATE_PAUSE_GUARDIAN = 0x78E6317DD6D43DdbDa00Dce32C2CbaFc99361a9d; // See - https://arbiscan.io/address/0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07#readProxyContract
    address constant public ARBITRUM_MARKET_UPDATE_PROPOSAL_GUARDIAN = 0x78E6317DD6D43DdbDa00Dce32C2CbaFc99361a9d; // See - https://arbiscan.io/address/0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07#readProxyContract

    // Base addresses
    address constant public BASE_LOCAL_TIMELOCK = 0xCC3E7c85Bb0EE4f09380e041fee95a0caeDD4a02; // See - https://basescan.org/address/0xCC3E7c85Bb0EE4f09380e041fee95a0caeDD4a02
    address constant public BASE_CONFIGURATOR_PROXY = 0x45939657d1CA34A8FA39A924B71D28Fe8431e581; // See - https://basescan.org/address/0x45939657d1CA34A8FA39A924B71D28Fe8431e581
    address constant public BASE_COMET_PROXY_ADMIN = 0xbdE8F31D2DdDA895264e27DD990faB3DC87b372d; // See - https://basescan.org/address/0xbdE8F31D2DdDA895264e27DD990faB3DC87b372d
    address constant public BASE_BRIDGE_RECEIVER = 0x18281dfC4d00905DA1aaA6731414EABa843c468A; // See - https://basescan.org/address/0x18281dfC4d00905DA1aaA6731414EABa843c468A

    address constant public BASE_MARKET_ADMIN = 0x7e14050080306cd36b47DE61ce604b3a1EC70c4e;
    address constant public BASE_MARKET_UPDATE_PAUSE_GUARDIAN = 0x3cb4653F3B45F448D9100b118B75a1503281d2ee; // See - https://basescan.org/address/0x46e6b214b524310239732D51387075E0e70970bf#readProxyContract
    address constant public BASE_MARKET_UPDATE_PROPOSAL_GUARDIAN = 0x3cb4653F3B45F448D9100b118B75a1503281d2ee; // See - https://basescan.org/address/0x46e6b214b524310239732D51387075E0e70970bf#readProxyContract

    // Scroll addresses
    address constant public SCROLL_LOCAL_TIMELOCK = 0xF6013e80E9e6AC211Cc031ad1CE98B3Aa20b73E4; // See - https://scrollscan.com/address/0xF6013e80E9e6AC211Cc031ad1CE98B3Aa20b73E4
    address constant public SCROLL_CONFIGURATOR_PROXY = 0xECAB0bEEa3e5DEa0c35d3E69468EAC20098032D7; // See - https://scrollscan.com/address/0xECAB0bEEa3e5DEa0c35d3E69468EAC20098032D7
    address constant public SCROLL_COMET_PROXY_ADMIN = 0x87A27b91f4130a25E9634d23A5B8E05e342bac50; // See - https://scrollscan.com/address/0x87A27b91f4130a25E9634d23A5B8E05e342bac50
    address constant public SCROLL_BRIDGE_RECEIVER = 0xC6bf5A64896D679Cf89843DbeC6c0f5d3C9b610D; // See - https://scrollscan.com/address/0xC6bf5A64896D679Cf89843DbeC6c0f5d3C9b610D

    address constant public SCROLL_MARKET_ADMIN = 0x7e14050080306cd36b47DE61ce604b3a1EC70c4e; // See - https://scrollscan.com/address/0x7e14050080306cd36b47DE61ce604b3a1EC70c4e
    address constant public SCROLL_MARKET_UPDATE_PAUSE_GUARDIAN = 0x0747a435b8a60070A7a111D015046d765098e4cc; // See - https://scrollscan.com/address/0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44#readProxyContract
    address constant public SCROLL_MARKET_UPDATE_PROPOSAL_GUARDIAN = 0x0747a435b8a60070A7a111D015046d765098e4cc; // See - https://scrollscan.com/address/0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44#readProxyContract

    // Optimism addresses
    address constant public OPTIMISM_LOCAL_TIMELOCK = 0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07; // See - https://optimistic.etherscan.io/address/0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07
    address constant public OPTIMISM_CONFIGURATOR_PROXY = 0x84E93EC6170ED630f5ebD89A1AAE72d4F63f2713; // See - https://optimistic.etherscan.io/address/0x84E93EC6170ED630f5ebD89A1AAE72d4F63f2713
    address constant public OPTIMISM_COMET_PROXY_ADMIN = 0x3C30B5a5A04656565686f800481580Ac4E7ed178; // See - https://optimistic.etherscan.io/address/0x3C30B5a5A04656565686f800481580Ac4E7ed178
    address constant public OPTIMISM_BRIDGE_RECEIVER = 0xC3a73A70d1577CD5B02da0bA91C0Afc8fA434DAF; // See - https://optimistic.etherscan.io/address/0x18281dfC4d00905DA1aaA6731414EABa843c468A

    address constant public OPTIMISM_MARKET_ADMIN = 0x7e14050080306cd36b47DE61ce604b3a1EC70c4e; // See - https://optimistic.etherscan.io/address/0x7e14050080306cd36b47DE61ce604b3a1EC70c4e
    address constant public OPTIMISM_MARKET_UPDATE_PAUSE_GUARDIAN = 0x3fFd6c073a4ba24a113B18C8F373569640916A45; // See - https://optimistic.etherscan.io/address/0xE36A30D249f7761327fd973001A32010b521b6Fd#readProxyContract
    address constant public OPTIMISM_MARKET_UPDATE_PROPOSAL_GUARDIAN = 0x3fFd6c073a4ba24a113B18C8F373569640916A45; // See - https://optimistic.etherscan.io/address/0xE36A30D249f7761327fd973001A32010b521b6Fd#readProxyContract

    // Mantle addresses
    address constant public MANTLE_MARKET_ADMIN = 0x7e14050080306cd36b47DE61ce604b3a1EC70c4e; // See - https://explorer.mantle.xyz/address/0x7e14050080306cd36b47DE61ce604b3a1EC70c4e
    address constant public MANTLE_MARKET_UPDATE_PAUSE_GUARDIAN = 0x2127338F0ff71Ecc779dce407D95C7D32f7C5F45; // See - https://explorer.mantle.xyz/address/0x2127338F0ff71Ecc779dce407D95C7D32f7C5F45
    address constant public MANTLE_MARKET_UPDATE_PROPOSAL_GUARDIAN = 0x2127338F0ff71Ecc779dce407D95C7D32f7C5F45; // See - https://explorer.mantle.xyz/address/0x2127338F0ff71Ecc779dce407D95C7D32f7C5F45

    address constant public MANTLE_LOCAL_TIMELOCK = 0x16C7B5C1b10489F4B111af11de2Bd607c9728107; // See - https://explorer.mantle.xyz/address/0x16C7B5C1b10489F4B111af11de2Bd607c9728107
    address constant public MANTLE_CONFIGURATOR_PROXY = 0xb77Cd4cD000957283D8BAf53cD782ECf029cF7DB; // See - https://explorer.mantle.xyz/address/0xb77Cd4cD000957283D8BAf53cD782ECf029cF7DB
    address constant public MANTLE_COMET_PROXY_ADMIN = 0xe268B436E75648aa0639e2088fa803feA517a0c7; // See - https://explorer.mantle.xyz/address/0xe268B436E75648aa0639e2088fa803feA517a0c7
    address constant public MANTLE_BRIDGE_RECEIVER = 0xc91EcA15747E73d6dd7f616C49dAFF37b9F1B604; // See - https://explorer.mantle.xyz/address/0xc91EcA15747E73d6dd7f616C49dAFF37b9F1B604

    function getChainAddresses(Chain chain) internal pure returns (ChainAddressesStruct memory) {
        if (chain == Chain.ETHEREUM) {
            return ChainAddressesStruct({
                governorTimelockAddress: MAINNET_GOVERNOR_TIMELOCK,
                configuratorProxyAddress: MAINNET_CONFIGURATOR_PROXY,
                cometProxyAdminAddress: MAINNET_COMET_PROXY_ADMIN,
                marketUpdatePauseGuardian: MAINNET_MARKET_UPDATE_PAUSE_GUARDIAN,
                marketUpdateProposalGuardian: MAINNET_MARKET_UPDATE_PROPOSAL_GUARDIAN,
                marketAdmin: MAINNET_MARKET_ADMIN
            });
        } else if (chain == Chain.LINEA) {
            return ChainAddressesStruct({
                governorTimelockAddress: LINEA_GOVERNOR_TIMELOCK,
                configuratorProxyAddress: LINEA_CONFIGURATOR_PROXY,
                cometProxyAdminAddress: LINEA_COMET_PROXY_ADMIN,
                marketUpdatePauseGuardian: LINEA_MARKET_UPDATE_PAUSE_GUARDIAN,
                marketUpdateProposalGuardian: LINEA_MARKET_UPDATE_PROPOSAL_GUARDIAN,
                marketAdmin: LINEA_MARKET_ADMIN
            });
        } else if (chain == Chain.RONIN) {
            return ChainAddressesStruct({
                governorTimelockAddress: RONIN_GOVERNOR_TIMELOCK,
                configuratorProxyAddress: RONIN_CONFIGURATOR_PROXY,
                cometProxyAdminAddress: RONIN_COMET_PROXY_ADMIN,
                marketUpdatePauseGuardian: RONIN_MARKET_UPDATE_PAUSE_GUARDIAN,
                marketUpdateProposalGuardian: RONIN_MARKET_UPDATE_PROPOSAL_GUARDIAN,
                marketAdmin: RONIN_MARKET_ADMIN
            });
        } else if (chain == Chain.UNICHAIN) {
            return ChainAddressesStruct({
                governorTimelockAddress: UNICHAIN_GOVERNOR_TIMELOCK,
                configuratorProxyAddress: UNICHAIN_CONFIGURATOR_PROXY,
                cometProxyAdminAddress: UNICHAIN_COMET_PROXY_ADMIN,
                marketUpdatePauseGuardian: UNICHAIN_MARKET_UPDATE_PAUSE_GUARDIAN,
                marketUpdateProposalGuardian: UNICHAIN_MARKET_UPDATE_PROPOSAL_GUARDIAN,
                marketAdmin: UNICHAIN_MARKET_ADMIN
            });
        } else if (chain == Chain.POLYGON) {
            return ChainAddressesStruct({
                governorTimelockAddress: POLYGON_LOCAL_TIMELOCK,
                configuratorProxyAddress: POLYGON_CONFIGURATOR_PROXY,
                cometProxyAdminAddress: POLYGON_COMET_PROXY_ADMIN,
                marketUpdatePauseGuardian: POLYGON_MARKET_UPDATE_PAUSE_GUARDIAN,
                marketUpdateProposalGuardian: POLYGON_MARKET_UPDATE_PROPOSAL_GUARDIAN,
                marketAdmin: POLYGON_MARKET_ADMIN
            });
        } else if (chain == Chain.ARBITRUM) {
            return ChainAddressesStruct({
                governorTimelockAddress: ARBITRUM_LOCAL_TIMELOCK,
                configuratorProxyAddress: ARBITRUM_CONFIGURATOR_PROXY,
                cometProxyAdminAddress: ARBITRUM_COMET_PROXY_ADMIN,
                marketUpdatePauseGuardian: ARBITRUM_MARKET_UPDATE_PAUSE_GUARDIAN,
                marketUpdateProposalGuardian: ARBITRUM_MARKET_UPDATE_PROPOSAL_GUARDIAN,
                marketAdmin: ARBITRUM_MARKET_ADMIN
            });
        } else if (chain == Chain.BASE) {
            return ChainAddressesStruct({
                governorTimelockAddress: BASE_LOCAL_TIMELOCK,
                configuratorProxyAddress: BASE_CONFIGURATOR_PROXY,
                cometProxyAdminAddress: BASE_COMET_PROXY_ADMIN,
                marketUpdatePauseGuardian: BASE_MARKET_UPDATE_PAUSE_GUARDIAN,
                marketUpdateProposalGuardian: BASE_MARKET_UPDATE_PROPOSAL_GUARDIAN,
                marketAdmin: BASE_MARKET_ADMIN
            });
        } else if (chain == Chain.SCROLL) {
            return ChainAddressesStruct({
                governorTimelockAddress: SCROLL_LOCAL_TIMELOCK,
                configuratorProxyAddress: SCROLL_CONFIGURATOR_PROXY,
                cometProxyAdminAddress: SCROLL_COMET_PROXY_ADMIN,
                marketUpdatePauseGuardian: SCROLL_MARKET_UPDATE_PAUSE_GUARDIAN,
                marketUpdateProposalGuardian: SCROLL_MARKET_UPDATE_PROPOSAL_GUARDIAN,
                marketAdmin: SCROLL_MARKET_ADMIN
            });
        } else if (chain == Chain.OPTIMISM) {
            return ChainAddressesStruct({
                governorTimelockAddress: OPTIMISM_LOCAL_TIMELOCK,
                configuratorProxyAddress: OPTIMISM_CONFIGURATOR_PROXY,
                cometProxyAdminAddress: OPTIMISM_COMET_PROXY_ADMIN,
                marketUpdatePauseGuardian: OPTIMISM_MARKET_UPDATE_PAUSE_GUARDIAN,
                marketUpdateProposalGuardian: OPTIMISM_MARKET_UPDATE_PROPOSAL_GUARDIAN,
                marketAdmin: OPTIMISM_MARKET_ADMIN
            });
        } else if (chain == Chain.MANTLE) {
            return ChainAddressesStruct({
                governorTimelockAddress: MANTLE_LOCAL_TIMELOCK,
                configuratorProxyAddress: MANTLE_CONFIGURATOR_PROXY,
                cometProxyAdminAddress: MANTLE_COMET_PROXY_ADMIN,
                marketUpdatePauseGuardian: MANTLE_MARKET_UPDATE_PAUSE_GUARDIAN,
                marketUpdateProposalGuardian: MANTLE_MARKET_UPDATE_PROPOSAL_GUARDIAN,
                marketAdmin: MANTLE_MARKET_ADMIN
            });
        } else {
            revert("MarketUpdateAddresses: Chain not supported");
        }
    }

    function getLocalTimelockAddress(Chain chain) internal pure returns (address) {
        if (chain == Chain.ETHEREUM) {
            return MAINNET_GOVERNOR_TIMELOCK;
        } else if (chain == Chain.POLYGON) {
            return POLYGON_LOCAL_TIMELOCK;
        } else if (chain == Chain.ARBITRUM) {
            return ARBITRUM_LOCAL_TIMELOCK;
        } else if (chain == Chain.BASE) {
            return BASE_LOCAL_TIMELOCK;
        } else if (chain == Chain.SCROLL) {
            return SCROLL_LOCAL_TIMELOCK;
        } else if (chain == Chain.OPTIMISM) {
            return OPTIMISM_LOCAL_TIMELOCK;
        } else if (chain == Chain.MANTLE) {
            return MANTLE_LOCAL_TIMELOCK;
        } else if (chain == Chain.LINEA) {
            return LINEA_GOVERNOR_TIMELOCK;
        } else if (chain == Chain.RONIN) {
            return RONIN_GOVERNOR_TIMELOCK;
        } else if (chain == Chain.UNICHAIN) {
            return UNICHAIN_GOVERNOR_TIMELOCK;
        } else {
            revert("MarketUpdateAddresses: Chain not supported");
        }
    }

    function getChainBasedOnChainId(uint chainId) public pure returns (Chain) {
        if(chainId == 1) {
            return Chain.ETHEREUM;
        } else if(chainId == 59144) {
            return Chain.LINEA;
        } else if(chainId == 2020) {
            return Chain.RONIN;
        } else if(chainId == 130) {
            return Chain.UNICHAIN;
        } else if(chainId == 137) {
            return Chain.POLYGON;
        } else if(chainId == 42161) {
            return Chain.ARBITRUM;
        } else if(chainId == 8453) {
            return Chain.BASE;
        } else if(chainId == 534352) {
            return Chain.SCROLL;
        } else if(chainId == 10) {
            return Chain.OPTIMISM;
        } else if(chainId == 11155111) {
            return Chain.MAINNET_SEPOLIA;
        } else if(chainId == 5000) {
            return Chain.MANTLE;
        } else {
            revert("MarketUpdateAddresses: Chain not supported");
        }
    }

}
