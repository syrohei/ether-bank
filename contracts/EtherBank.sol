pragma solidity ^0.4.2;

import "User.sol";

// This is just a simple example of a coin-like contract.
// It is not standards compatible and cannot be expected to talk to other
// coin/token contracts. If you want to create a standards-compliant
// token, see: https://github.com/ConsenSys/Tokens. Cheers!

contract EtherBank {
  address owner = 0x8f10c10406c56a7788a7ff0117016f3714123723;

  User user = new User(owner);

  function getBalanceOfGeneral(address _addr) returns(uint){
    return user.getBalanceOfGeneral(_addr);
	}

  function getBalanceOfLending(address _addr) returns(uint) {
    return user.getBalanceOfLending(_addr);
  }
}
