/*
    This is a specification file for the verification of Comet.sol
    smart contract using the Certora prover. For more information,
	visit: https://www.certora.com/

    This file is run with scripts/verifyGlobalCollateralAsset.sh

    This file contains rules related to collateral asset info.
*/
import "setup_noSummarization.spec"

////////////////////////////////////////////////////////////////////////////////
//////////////////////////   Methods Declarations   ////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

methods{
    getUserCollateralBalance(address, address) returns (uint128) envfree
    call_getPackedAsset(uint8, address, address, uint8, uint64, uint64, uint64 ,uint128) returns (uint256, uint256) envfree
    getAsset00_a() returns (uint256) envfree
    getAsset00_b() returns (uint256) envfree
    getAssetInfo(uint8) envfree 
    powerOfTen(uint8) returns (uint64) envfree

    test() envfree
}

////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////   Properties   ///////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//
//  @Complete Run: https://vaas-stg.certora.com/output/44289/7284048c8fbf909492a9/?anonymousKey=c227c7e03da3d5ae968061657d93c30958f367eb

/*
    @Rule

    @Description:
        Checking correct unpacking of assetInfo after packing.

    @Formula:
        {
            
        }
        
        word_a, word_b = call_getPackedAsset(i, assetArg, priceFeedArg, decimalsArg, borrowCollateralFactorArg, liquidateCollateralFactorArg, liquidationFactorArg, supplyCapArg) &&
        offset_, asset_, priceFeed_, scale_, borrowCollateralFactor_, liquidateCollateralFactor_, liquidationFactor_, supplyCap_ = getAssetInfo(i)

        {
            assetArg == 0 => (asset_ == assetArg &&
                              priceFeed_ == 0 &&
                              scale_ == 10^0 &&
                              borrowCollateralFactor_ == 0 &&
                              liquidateCollateralFactor_ == 0 &&
                              liquidationFactor_ == 0 &&
                              supplyCap_ == 0)
                    &&
            assetArg != 0 => (asset_ == assetArg &&
                              priceFeed_ == priceFeedArg &&
                              scale_ == powerOfTen(decimalArgs) &&
                              borrowCollateralFactor_ == borrowCollateralFactorArg &&
                              liquidateCollateralFactor_ == liquidateCollateralFactorArg &&
                              liquidationFactor_ == liquidationFactorArg &&
                              supplyCap_ == supplyCapArg)
        }

    @Note:
        Assuming storage of the packed info to assetXX_a and assetXX_b is being done correctly

    @Link:
        https://vaas-stg.certora.com/output/44289/440b2480ee47ade7c8c8/?anonymousKey=00dccb7618aa762ec6c95274cae99909a5f75c7b
*/
 
rule reversibility_of_packing(uint8 i, address assetArg, address priceFeedArg, uint8 decimalsArg, uint64 borrowCollateralFactorArg, uint64 liquidateCollateralFactorArg, uint64 liquidationFactorArg, uint128 supplyCapArg){
    require i == 0; // checking for the 1st asset only, assuming that the retrieval of the correct asset in _getAssetConfig being done correctly
    uint256 word_a; uint256 word_b;
    word_a, word_b = call_getPackedAsset(i, assetArg, priceFeedArg, decimalsArg, borrowCollateralFactorArg, liquidateCollateralFactorArg, liquidationFactorArg, supplyCapArg); 
    uint8 offset_; address asset_; address priceFeed_; uint64 scale_; uint64 borrowCollateralFactor_; uint64 liquidateCollateralFactor_; uint64 liquidationFactor_; uint128 supplyCap_;
    offset_, asset_, priceFeed_, scale_, borrowCollateralFactor_, liquidateCollateralFactor_, liquidationFactor_, supplyCap_ = getAssetInfo(i);
    require word_a == getAsset00_a() && word_b == getAsset00_b(); // assumption that assetXX_a, assetXX_b are being loaded with correct value
    if (assetArg == 0){
        assert (asset_ == assetArg, "asset is non-zero");
        assert (priceFeed_ == 0, "price feed is non-zero");
        assert (scale_ == 10^0, "scale is not 1");
        assert (borrowCollateralFactor_ == 0, "borrow Collateral Factor is non-zero");
        assert (liquidateCollateralFactor_ == 0, "liquidate Collateral Factor is non-zero");
        assert (liquidationFactor_ == 0, "liquidation Factor is non-zero");
        assert (supplyCap_ == 0, "supply cap is non-zero");
    }
    else{
        assert (asset_ == assetArg, "asset got packed/unpacked wrongfully");
        assert (priceFeed_ == priceFeedArg, "price feed got packed/unpacked wrongfully");
        assert (scale_ == powerOfTen(decimalsArg), "decimals got packed/unpacked wrongfully");
        assert (borrowCollateralFactor_ == borrowCollateralFactorArg, "borrow collateral factor got packed/unpacked wrongfully");
        assert (liquidateCollateralFactor_ == liquidateCollateralFactorArg, "liquidation collateral factor got packed/unpacked wrongfully");
        assert (liquidationFactor_ == liquidationFactorArg, "liquidation factor got packed/unpacked wrongfully");
        assert (supplyCap_ == supplyCapArg, "supply got packed/unpacked wrongfully");
    }
}
