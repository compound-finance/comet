// XXX Define strict types for these objects
export interface Requirements {
    tokenBalances?: object, // XXX Balance constraint
    cometBalances?: object, // XXX Comet balance constraint
    upgrade?: boolean, // Modern constraint
    cometConfig?: object, // XXX Modern constraint
    pause?: object, // XXX Pause constraint
    remoteToken?: object, // XXX Remote token constraint
    utilization?: number, // Utilization constraint
    baseToken?: object, // XXX Base token protocol balance constraint
};