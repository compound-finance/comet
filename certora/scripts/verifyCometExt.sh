if [[ "$1" ]]
then
    RULE="--rule $1"
fi

certoraRun certora/munged/CometExt.sol  \
    --verify CometExt:certora/specs/cometExt.spec  \
    --solc solc8.15 \
    --cloud \
    $RULE \
    --optimistic_loop \
    --settings -enableEqualitySaturation=false,-solver=z3,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2 \
    --solc_args '["--experimental-via-ir"]' \
    --msg "CometExt:cometExt.spec $RULE"
