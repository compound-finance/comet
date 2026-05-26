// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

/**
 * One-shot test-fund faucet for the compound-on-rome-demo /faucet page.
 *
 * On `claim()`:
 *   1. Sends `gasDrop` native gas to msg.sender (one-time per wallet)
 *   2. Transfers `tokenDrop[token]` of each registered ERC20 to msg.sender
 *
 * Each wallet can claim AT MOST ONCE. Pre-funding is the operator's job —
 * unlike Aave's Faucet which mints from `MockToken`s with public mint,
 * Compound's `SPL_ERC20_cached` wrappers have no public mint. Deployer
 * transfers an inventory of each wrapper to this contract before claims
 * open and tops the contract up periodically.
 *
 * Deployer is the owner. Pre-funds native gas via the constructor's
 * payable + `receive()`. Pre-funds tokens via direct ERC20 transfer to
 * `address(this)` — anyone can top up.
 */
interface IERC20Min {
  function transfer(address to, uint256 amount) external returns (bool);
  function balanceOf(address account) external view returns (uint256);
}

contract CompoundFaucet {
  address public immutable owner;
  uint256 public immutable gasDrop;
  address[] public tokens;
  mapping(address => uint256) public tokenDrop;
  mapping(address => bool)    public claimed;

  event Claimed(address indexed user, uint256 gasAmount, uint256 tokenCount);
  event TokenAdded(address indexed token, uint256 amount);

  modifier onlyOwner() {
    require(msg.sender == owner, "CompoundFaucet: not owner");
    _;
  }

  constructor(uint256 _gasDrop) payable {
    owner = msg.sender;
    gasDrop = _gasDrop;
  }

  /// @notice Accept native gas top-ups any time.
  receive() external payable {}

  /// @notice Register an ERC20 with this faucet. `amount` is the per-claim
  /// drop in raw token units (caller pre-multiplies by 10**decimals).
  function addToken(address token, uint256 amount) external onlyOwner {
    tokens.push(token);
    tokenDrop[token] = amount;
    emit TokenAdded(token, amount);
  }

  /// @notice One-time drop: gasDrop native + tokenDrop[t] for each registered token.
  function claim() external {
    require(!claimed[msg.sender], "CompoundFaucet: already claimed");
    claimed[msg.sender] = true;

    // Native gas first — preflight failure here aborts the whole drop.
    if (gasDrop > 0) {
      require(address(this).balance >= gasDrop, "CompoundFaucet: out of gas reserve");
      (bool ok, ) = msg.sender.call{value: gasDrop}("");
      require(ok, "CompoundFaucet: gas send failed");
    }

    // Each registered token: simple ERC20 transfer from the faucet's balance
    // to msg.sender. Reverts the whole claim() if any single transfer fails
    // — keeps `claimed[user]` consistent with what was actually paid out.
    uint256 n = tokens.length;
    for (uint256 i = 0; i < n; i++) {
      address t = tokens[i];
      uint256 amount = tokenDrop[t];
      if (amount > 0) {
        require(
          IERC20Min(t).balanceOf(address(this)) >= amount,
          "CompoundFaucet: out of token reserve"
        );
        require(IERC20Min(t).transfer(msg.sender, amount), "CompoundFaucet: token transfer failed");
      }
    }

    emit Claimed(msg.sender, gasDrop, n);
  }

  function tokenList() external view returns (address[] memory) {
    return tokens;
  }
}
