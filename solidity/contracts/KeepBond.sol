pragma solidity ^0.5.4;

/// @title Keep Bond
/// @notice Contract holding deposits from keeps' operators.
contract KeepBond {
   // Unassigned ether values deposited by operators.
   mapping(address => uint256) internal pot;

   /// @notice Returns value of ether available for bonding for the operator.
   /// @param operator Address of the operator.
   /// @return Value of deposited ether available for bonding.
   function availableForBonding(address operator) public view returns (uint256) {
      return pot[operator];
   }

   /// @notice Add ether to sender's value available for bonding.
   function deposit() external payable {
      pot[msg.sender] += msg.value;
   }

   /// @notice Draw amount from sender's value available for bonding.
   /// @param amount Value to withdraw.
   /// @param destination Address to send amount.
   function withdraw(uint256 amount, address payable destination) external {
      require(availableForBonding(msg.sender) >= amount, "Insufficient pot");

      pot[msg.sender] -= amount;
      destination.transfer(amount);
   }
}
