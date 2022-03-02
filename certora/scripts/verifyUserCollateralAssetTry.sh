certoraRun certora/harness/UserCollateralAssetTry.sol \
    --verify UserCollateralAssetTry:certora/specs/UserCollateralAssetTry.spec  \
    --solc solc8.11 \
    --staging shelly/integrateJohnsBranches \
    --optimistic_loop \
    --rule check_update_UserCollateral_red \
    --settings -useBitVectorTheory,-smt_hashingScheme=plainInjectivity,-deleteSMTFile=false,-postProcessCounterExamples=false \
    --msg "$1"