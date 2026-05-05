// SPDX-License-Identifier: BSD-3-Clause
pragma solidity 0.8.15;
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}
contract SimplePullProxy {
    function pull(address token, address from, uint256 amount) external {
        IERC20(token).transferFrom(from, address(this), amount);
    }
    function relayApprove(address token, address spender, uint256 amount) external {
        IERC20(token).approve(spender, amount);
    }
}
