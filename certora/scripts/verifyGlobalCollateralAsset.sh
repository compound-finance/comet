certoraRun certora/harness/CometHarnessWrappers.sol \
    --verify CometHarnessWrappers:certora/specs/GlobalCollateralAsset.spec  \
    --solc solc8.11 \
    --staging shelly/integrateJohnsBranches \
    --optimistic_loop \
    --rule reversability_of_packing \
    --settings -useBitVectorTheory,-smt_hashingScheme=plainInjectivity,-deleteSMTFile=false,-postProcessCounterExamples=false \
    --msg "$1"