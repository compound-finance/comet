certoraRun certora/harness/CometHarnessInterest.sol \
    --verify CometHarnessInterest:certora/specs/interestComputation.spec  \
    --solc solc8.11 \
    --staging jtoman/solc8-overflow \
    --settings -enableEqualitySaturation=false,-multiAssertCheck \
    --optimistic_loop \
    --rule $1 \
    --msg "Comet $1"