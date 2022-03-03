certoraRun certora/harness/UserCollateralAssetTry.sol \
    --verify UserCollateralAssetTry:certora/specs/UserCollateralAssetTry.spec  \
    --solc solc8.11 \
    --staging shelly/integrateJohnsBranches \
    --optimistic_loop \
    --rule check_update_UserCollateral_red \
    --settings -smt_liaBeforeBv=false,-deleteSMTFile=false,-smt_bitVectorTheory=true,-smt_hashingScheme=plainInjectivity \
    --msg "$1"
