certoraRun certora/harness/CometHarnessWrappers.sol \
    --verify CometHarnessWrappers:certora/specs/UserCollateralAsset.spec  \
    --solc solc8.11 \
    --staging \
    --send_only \
    --optimistic_loop \
    --send_only \
    --settings -useBitVectorTheory,-smt_hashingScheme=plainInjectivity,-deleteSMTFile=false,-postProcessCounterExamples=false \
    --solc_args '["--experimental-via-ir"]' \
    --msg "UserCollateralAsset $1"