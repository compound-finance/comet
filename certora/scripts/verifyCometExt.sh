if [[ "$1" ]]
then
    RULE="--rule $1"
fi

certoraRun contracts/CometExt.sol  \
    --verify CometExt:certora/specs/cometExt.spec  \
<<<<<<< HEAD
    --solc solc8.13 \
    --cloud \
    --disable_auto_cache_key_gen \
    $RULE \
=======
    --solc solc8.11 \
    --cloud \
    $RULE \
    --send_only \
>>>>>>> upstream/certora
    --optimistic_loop \
    --settings -enableEqualitySaturation=false,-solver=z3,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2 \
    --solc_args '["--experimental-via-ir"]' \
    --msg "CometExt:cometExt.spec $RULE"
