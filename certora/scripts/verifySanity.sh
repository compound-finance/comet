for f in certora/harness/*.sol
do
    echo "Processing $f"
    file=$(basename $f)
    echo ${file%.*}
    certoraRun certora/harness/$file \
    --verify ${file%.*}:certora/specs/sanity.spec "$@" \
<<<<<<< HEAD
    --solc solc8.13 --cloud \
    --disable_auto_cache_key_gen \
=======
    --solc solc8.11 --cloud \
>>>>>>> upstream/certora
    --send_only \
    --msg "checking sanity on ${file%.*}"
done