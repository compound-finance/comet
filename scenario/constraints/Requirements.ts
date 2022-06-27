// XXX Define strict types for these objects
export interface Requirements {
    tokenBalances?: object, // XXX Token balance constraint
    cometBalances?: object, // XXX Comet balance constraint
    upgrade?: boolean, // Modern constraint
    upgradeAll?: boolean, // Modern constraint
    cometConfig?: object, // XXX Modern constraint
    pause?: object, // XXX Pause constraint
    remoteToken?: object, // XXX Remote token constraint
    utilization?: number, // Utilization constraint
    migrate?: boolean, // XXX Migration constraint
};