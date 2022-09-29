if [[ "$1" ]]
then
    RULE="--rule $1"
fi

certoraRun certora/harness/CometHarnessGetters.sol \
    --verify CometHarnessGetters:certora/specs/pause.spec  \
    --solc solc8.15 \
    --cloud \
    $RULE \
    --optimistic_loop \
    --settings -useBitVectorTheory \
    --solc_args '["--experimental-via-ir"]' \
    --msg "CometHarnessGetters:pause.spec $RULE"