pragma solidity ^0.5.4;

/// @title Keep Bonding
/// @notice Contract holding deposits from keeps' operators.
contract KeepBonding {
   // Unassigned ether values deposited by operators.
   mapping(address => uint256) internal unbondedValue;

   /// @notice Returns value of ether available for bonding for the operator.
   /// @param operator Address of the operator.
   /// @return Value of deposited ether available for bonding.
   function availableBondingValue(address operator) public view returns (uint256) {
      return unbondedValue[operator];
   }

   /// @notice Add ether to operator's value available for bonding.
   /// @param operator Address of the operator.
   function deposit(address operator) external payable {
      unbondedValue[operator] += msg.value;
   }

   /// @notice Draw amount from sender's value available for bonding.
   /// @param amount Value to withdraw.
   /// @param destination Address to send amount.
   function withdraw(uint256 amount, address payable destination) external {
      require(availableBondingValue(msg.sender) >= amount, "Insufficient unbonded value");

      unbondedValue[msg.sender] -= amount;
      destination.transfer(amount);
   }

   /// @notice Create bond for given operator, reference and amount.
   /// @dev Function can be executed only by authorized contract which will become
   /// bond's holder.
   /// @param operator Address of the operator to bond.
   /// @param ref Reference used to track the bond by holder.
   /// @param amount Value to bond.
   function createBond(address operator, uint256 ref, uint256 amount) public onlyAuthorized {
      require(availableForBonding(operator) >= amount, "Insufficient pot");

      address holder = msg.sender;
      bytes memory bondID = abi.encodePacked(operator, holder, ref);
      bytes memory assignment = abi.encodePacked(operator, holder);

      pot[operator] -= amount;
      lockedBonds[bondID] += amount;
      bondAssignments[assignment].push(ref);
   }

   /// @notice Checks if the caller is an authorized contract.
   /// @dev Throws an error if called by any account other than one of the authorized
   /// contracts.
   modifier onlyAuthorized() {
      // TODO: Add authorization checks.
      _;
   }
}
