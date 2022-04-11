if [[ "$1" ]]
then
    RULE="--rule $1"
fi

certoraRun certora/harness/CometHarnessWrappers.sol \
    --verify CometHarnessWrappers:certora/specs/userAssetIn.spec  \
    --solc solc8.11 \
    --cloud \
    $RULE \
    --send_only \
    --optimistic_loop \
    --send_only \
    --settings -useBitVectorTheory,-smt_hashingScheme=plainInjectivity,-deleteSMTFile=false,-postProcessCounterExamples=false \
    --solc_args '["--experimental-via-ir"]' \
    --msg "CometHarnessWrappers:userAssetIn.spec $RULE"