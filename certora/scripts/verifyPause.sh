if [[ "$1" ]]
then
    RULE="--rule $1"
fi

certoraRun certora/harness/CometHarnessGetters.sol \
    --verify CometHarnessGetters:certora/specs/pause.spec  \
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
    --settings -useBitVectorTheory \
    --solc_args '["--experimental-via-ir"]' \
    --msg "CometHarnessGetters:pause.spec $RULE"