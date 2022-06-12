if [[ "$1" ]]
then
    RULE="--rule $1"
fi

certoraRun certora/harness/CometHarnessWrappers.sol \
    --verify CometHarnessWrappers:certora/specs/userAssetIn.spec  \
<<<<<<< HEAD
    --solc solc8.13 \
    --cloud \
    --disable_auto_cache_key_gen \
    $RULE \
    --optimistic_loop \
    --settings -useBitVectorTheory,-smt_hashingScheme=plainInjectivity,-deleteSMTFile=false,-postProcessCounterExamples=false,-solvers=bitwuzla \
=======
    --solc solc8.11 \
    --cloud \
    $RULE \
    --send_only \
    --optimistic_loop \
    --send_only \
    --settings -useBitVectorTheory,-smt_hashingScheme=plainInjectivity,-deleteSMTFile=false,-postProcessCounterExamples=false \
>>>>>>> upstream/certora
    --solc_args '["--experimental-via-ir"]' \
    --msg "CometHarnessWrappers:userAssetIn.spec $RULE"