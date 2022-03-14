certoraRun certora/harness/CometHarness.sol \
    --verify CometHarness:certora/specs/UserCollateralAsset.spec  \
    --solc solc8.11 \
    --staging \
    --optimistic_loop \
    --settings -useBitVectorTheory,-smt_hashingScheme=plainInjectivity,-deleteSMTFile=false,-postProcessCounterExamples=false \
    --solc_args '["--experimental-via-ir"]' \
    --msg "UserCollateralAsset $1"