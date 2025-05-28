module.exports = {
  configureYulOptimizer: true, // (Experimental). Should resolve 'stack too deep' in projects using ABIEncoderV2.
  skipFiles: ['test/', 'vendor/', 'ERC20.col'],
  mocha: {
      fgrep: '[skip-on-coverage]',
      invert: true
  }
};
