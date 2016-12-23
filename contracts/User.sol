pragma solidity ^0.4.2;


// This is just a simple example of a coin-like contract.
// It is not standards compatible and cannot be expected to talk to other
// coin/token contracts. If you want to create a standards-compliant
// token, see: https://github.com/ConsenSys/Tokens. Cheers!

import "Validate.sol";

contract owned {
  function owned() {  }
  address owner;

  modifier onlyOwner {
    if (msg.sender != owner)
      throw;
    _;
  }
}


contract User is owned{
  mapping (address => uint) balances;
  mapping (address => mapping (address => uint)) lending_balances;

  Validate.Data validated_user;
  Validate.Data locked_user;


  function User(address _owner ){
    owner = _owner;
  }

  function register(address _user) onlyOwner {
    if (!Validate.insert(validated_user, _user))
      throw;
  }
  function remove(address _user) onlyOwner {
    if (!onlyUser(_user))
      throw;
    if (!Validate.remove(validated_user, _user))
      throw;
  }

  function account_lock(address _user) onlyOwner {
    if (!onlyUser(_user) || !lockable(_user))
      throw;
    if (!Validate.insert(locked_user, _user))
      throw;
  }

  function send(address _receiver, uint _amount) returns(bool) {
    if (!onlyUser(msg.sender) || !onlyUser(_receiver)  || !lockable(msg.sender) )
      return false;
    if (balances[msg.sender] < _amount)
      return false;

    balances[msg.sender] -= _amount;
    balances[_receiver] += _amount;
    return true;
  }

  function lendingFrom(address _receiver, uint _amount) returns(bool) {
    if (!send(_receiver, _amount))
      return false;

    lending_balances[msg.sender][_receiver] += _amount;
    return true;
  }

  function getBalanceOfGeneral(address addr) returns(uint) {
    return balances[addr];
  }

  function getBalanceOfLending(address _lender, address _receiver) returns(uint) {
    return lending_balances[_lender][_receiver];
  }

  function onlyUser(address _user) returns (bool){
    return Validate.show(validated_user, _user);
  }

  function lockable(address _user) returns (bool){
    return Validate.show(locked_user, _user);

  }
}
