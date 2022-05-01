// sanity rule
rule sanity(method f) {
	env e;
	calldataarg arg;
	f(e, arg);
	assert false, "this method should have a non reverting path";
}