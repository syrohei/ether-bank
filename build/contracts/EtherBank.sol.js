var Web3 = require("web3");
var SolidityEvent = require("web3/lib/web3/event.js");

(function() {
  // Planned for future features, logging, etc.
  function Provider(provider) {
    this.provider = provider;
  }

  Provider.prototype.send = function() {
    this.provider.send.apply(this.provider, arguments);
  };

  Provider.prototype.sendAsync = function() {
    this.provider.sendAsync.apply(this.provider, arguments);
  };

  var BigNumber = (new Web3()).toBigNumber(0).constructor;

  var Utils = {
    is_object: function(val) {
      return typeof val == "object" && !Array.isArray(val);
    },
    is_big_number: function(val) {
      if (typeof val != "object") return false;

      // Instanceof won't work because we have multiple versions of Web3.
      try {
        new BigNumber(val);
        return true;
      } catch (e) {
        return false;
      }
    },
    merge: function() {
      var merged = {};
      var args = Array.prototype.slice.call(arguments);

      for (var i = 0; i < args.length; i++) {
        var object = args[i];
        var keys = Object.keys(object);
        for (var j = 0; j < keys.length; j++) {
          var key = keys[j];
          var value = object[key];
          merged[key] = value;
        }
      }

      return merged;
    },
    promisifyFunction: function(fn, C) {
      var self = this;
      return function() {
        var instance = this;

        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {
          var callback = function(error, result) {
            if (error != null) {
              reject(error);
            } else {
              accept(result);
            }
          };
          args.push(tx_params, callback);
          fn.apply(instance.contract, args);
        });
      };
    },
    synchronizeFunction: function(fn, instance, C) {
      var self = this;
      return function() {
        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {

          var decodeLogs = function(logs) {
            return logs.map(function(log) {
              var logABI = C.events[log.topics[0]];

              if (logABI == null) {
                return null;
              }

              var decoder = new SolidityEvent(null, logABI, instance.address);
              return decoder.decode(log);
            }).filter(function(log) {
              return log != null;
            });
          };

          var callback = function(error, tx) {
            if (error != null) {
              reject(error);
              return;
            }

            var timeout = C.synchronization_timeout || 240000;
            var start = new Date().getTime();

            var make_attempt = function() {
              C.web3.eth.getTransactionReceipt(tx, function(err, receipt) {
                if (err) return reject(err);

                if (receipt != null) {
                  // If they've opted into next gen, return more information.
                  if (C.next_gen == true) {
                    return accept({
                      tx: tx,
                      receipt: receipt,
                      logs: decodeLogs(receipt.logs)
                    });
                  } else {
                    return accept(tx);
                  }
                }

                if (timeout > 0 && new Date().getTime() - start > timeout) {
                  return reject(new Error("Transaction " + tx + " wasn't processed in " + (timeout / 1000) + " seconds!"));
                }

                setTimeout(make_attempt, 1000);
              });
            };

            make_attempt();
          };

          args.push(tx_params, callback);
          fn.apply(self, args);
        });
      };
    }
  };

  function instantiate(instance, contract) {
    instance.contract = contract;
    var constructor = instance.constructor;

    // Provision our functions.
    for (var i = 0; i < instance.abi.length; i++) {
      var item = instance.abi[i];
      if (item.type == "function") {
        if (item.constant == true) {
          instance[item.name] = Utils.promisifyFunction(contract[item.name], constructor);
        } else {
          instance[item.name] = Utils.synchronizeFunction(contract[item.name], instance, constructor);
        }

        instance[item.name].call = Utils.promisifyFunction(contract[item.name].call, constructor);
        instance[item.name].sendTransaction = Utils.promisifyFunction(contract[item.name].sendTransaction, constructor);
        instance[item.name].request = contract[item.name].request;
        instance[item.name].estimateGas = Utils.promisifyFunction(contract[item.name].estimateGas, constructor);
      }

      if (item.type == "event") {
        instance[item.name] = contract[item.name];
      }
    }

    instance.allEvents = contract.allEvents;
    instance.address = contract.address;
    instance.transactionHash = contract.transactionHash;
  };

  // Use inheritance to create a clone of this contract,
  // and copy over contract's static functions.
  function mutate(fn) {
    var temp = function Clone() { return fn.apply(this, arguments); };

    Object.keys(fn).forEach(function(key) {
      temp[key] = fn[key];
    });

    temp.prototype = Object.create(fn.prototype);
    bootstrap(temp);
    return temp;
  };

  function bootstrap(fn) {
    fn.web3 = new Web3();
    fn.class_defaults  = fn.prototype.defaults || {};

    // Set the network iniitally to make default data available and re-use code.
    // Then remove the saved network id so the network will be auto-detected on first use.
    fn.setNetwork("default");
    fn.network_id = null;
    return fn;
  };

  // Accepts a contract object created with web3.eth.contract.
  // Optionally, if called without `new`, accepts a network_id and will
  // create a new version of the contract abstraction with that network_id set.
  function Contract() {
    if (this instanceof Contract) {
      instantiate(this, arguments[0]);
    } else {
      var C = mutate(Contract);
      var network_id = arguments.length > 0 ? arguments[0] : "default";
      C.setNetwork(network_id);
      return C;
    }
  };

  Contract.currentProvider = null;

  Contract.setProvider = function(provider) {
    var wrapped = new Provider(provider);
    this.web3.setProvider(wrapped);
    this.currentProvider = provider;
  };

  Contract.new = function() {
    if (this.currentProvider == null) {
      throw new Error("EtherBank error: Please call setProvider() first before calling new().");
    }

    var args = Array.prototype.slice.call(arguments);

    if (!this.unlinked_binary) {
      throw new Error("EtherBank error: contract binary not set. Can't deploy new instance.");
    }

    var regex = /__[^_]+_+/g;
    var unlinked_libraries = this.binary.match(regex);

    if (unlinked_libraries != null) {
      unlinked_libraries = unlinked_libraries.map(function(name) {
        // Remove underscores
        return name.replace(/_/g, "");
      }).sort().filter(function(name, index, arr) {
        // Remove duplicates
        if (index + 1 >= arr.length) {
          return true;
        }

        return name != arr[index + 1];
      }).join(", ");

      throw new Error("EtherBank contains unresolved libraries. You must deploy and link the following libraries before you can deploy a new version of EtherBank: " + unlinked_libraries);
    }

    var self = this;

    return new Promise(function(accept, reject) {
      var contract_class = self.web3.eth.contract(self.abi);
      var tx_params = {};
      var last_arg = args[args.length - 1];

      // It's only tx_params if it's an object and not a BigNumber.
      if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
        tx_params = args.pop();
      }

      tx_params = Utils.merge(self.class_defaults, tx_params);

      if (tx_params.data == null) {
        tx_params.data = self.binary;
      }

      // web3 0.9.0 and above calls new twice this callback twice.
      // Why, I have no idea...
      var intermediary = function(err, web3_instance) {
        if (err != null) {
          reject(err);
          return;
        }

        if (err == null && web3_instance != null && web3_instance.address != null) {
          accept(new self(web3_instance));
        }
      };

      args.push(tx_params, intermediary);
      contract_class.new.apply(contract_class, args);
    });
  };

  Contract.at = function(address) {
    if (address == null || typeof address != "string" || address.length != 42) {
      throw new Error("Invalid address passed to EtherBank.at(): " + address);
    }

    var contract_class = this.web3.eth.contract(this.abi);
    var contract = contract_class.at(address);

    return new this(contract);
  };

  Contract.deployed = function() {
    if (!this.address) {
      throw new Error("Cannot find deployed address: EtherBank not deployed or address not set.");
    }

    return this.at(this.address);
  };

  Contract.defaults = function(class_defaults) {
    if (this.class_defaults == null) {
      this.class_defaults = {};
    }

    if (class_defaults == null) {
      class_defaults = {};
    }

    var self = this;
    Object.keys(class_defaults).forEach(function(key) {
      var value = class_defaults[key];
      self.class_defaults[key] = value;
    });

    return this.class_defaults;
  };

  Contract.extend = function() {
    var args = Array.prototype.slice.call(arguments);

    for (var i = 0; i < arguments.length; i++) {
      var object = arguments[i];
      var keys = Object.keys(object);
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        var value = object[key];
        this.prototype[key] = value;
      }
    }
  };

  Contract.all_networks = {
  "1": {
    "abi": [
      {
        "constant": false,
        "inputs": [
          {
            "name": "_lender",
            "type": "address"
          },
          {
            "name": "_receiver",
            "type": "address"
          }
        ],
        "name": "getBalanceOfLending",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_receiver",
            "type": "address"
          },
          {
            "name": "_amount",
            "type": "uint256"
          }
        ],
        "name": "lending",
        "outputs": [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_addr",
            "type": "address"
          }
        ],
        "name": "getBalanceOfGeneral",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      }
    ],
    "unlinked_binary": "0x6060604081905260008054600160a060020a031916738f10c10406c56a7788a7ff0117016f37141237231790819055600160a060020a03169061061e806102db8339018082600160a060020a03168152602001915050604051809103906000f080156100005760018054600160a060020a0319166c010000000000000000000000009283029290920491909117905534610000575b610239806100a26000396000f3606060405260e060020a600035046371dcf0578114610034578063d21ccead14610059578063dafaa27e14610080575b610000565b34610000576100476004356024356100a2565b60408051918252519081900360200190f35b346100005761006c60043560243561012f565b604080519115158252519081900360200190f35b34610000576100476004356101bb565b60408051918252519081900360200190f35b600154604080516000602091820181905282517f71dcf057000000000000000000000000000000000000000000000000000000008152600160a060020a03878116600483015286811660248301529351919493909316926371dcf05792604480830193919282900301818787803b156100005760325a03f115610000575050604051519150505b92915050565b600154604080516000602091820181905282517f4c1c85e2000000000000000000000000000000000000000000000000000000008152600160a060020a03878116600483015260248201879052935191949390931692634c1c85e292604480830193919282900301818787803b156100005760325a03f115610000575050604051519150505b92915050565b6000600160009054906101000a9004600160a060020a0316600160a060020a031663dafaa27e836000604051602001526040518260e060020a0281526004018082600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051519150505b919050566060604052346100005760405160208061061e83398101604052515b5b5b60008054600160a060020a0319166c01000000000000000000000000838102041790555b505b6105cd806100516000396000f3606060405236156100775760e060020a600035046329092d0e811461007c5780633989101d1461008e5780634420e486146100a05780634c1c85e2146100b257806350556df2146100d957806371dcf057146100fd578063a1bd281c14610122578063d0679d3414610146578063dafaa27e1461016d575b610000565b346100005761008c60043561018f565b005b346100005761008c600435610240565b005b346100005761008c600435610302565b005b34610000576100c560043560243561039f565b604080519115158252519081900360200190f35b34610000576100c56004356103ee565b604080519115158252519081900360200190f35b3461000057610110600435602435610469565b60408051918252519081900360200190f35b34610000576100c5600435610496565b604080519115158252519081900360200190f35b34610000576100c5600435602435610511565b604080519115158252519081900360200190f35b34610000576101106004356105ae565b60408051918252519081900360200190f35b60005433600160a060020a039081169116146101aa57610000565b6101b381610496565b15156101be57610000565b73__Validate______________________________6320d26d326003836000604051602001526040518360e060020a0281526004018083815260200182600160a060020a031681526020019250505060206040518083038186803b156100005760325a03f415610000575050604051511515905061023b57610000565b5b5b50565b60005433600160a060020a0390811691161461025b57610000565b61026481610496565b15806102765750610274816103ee565b155b1561028057610000565b73__Validate______________________________636d16738a6004836000604051602001526040518360e060020a0281526004018083815260200182600160a060020a031681526020019250505060206040518083038186803b156100005760325a03f415610000575050604051511515905061023b57610000565b5b5b50565b60005433600160a060020a0390811691161461031d57610000565b73__Validate______________________________636d16738a6003836000604051602001526040518360e060020a0281526004018083815260200182600160a060020a031681526020019250505060206040518083038186803b156100005760325a03f415610000575050604051511515905061023b57610000565b5b5b50565b60006103ab8383610511565b15156103b9575060006103e8565b50600160a060020a03338116600090815260026020908152604080832093861683529290522080548201905560015b92915050565b600073__Validate______________________________6346f5177f6004846000604051602001526040518360e060020a0281526004018083815260200182600160a060020a031681526020019250505060206040518083038186803b156100005760325a03f415610000575050604051519150505b919050565b600160a060020a038083166000908152600260209081526040808320938516835292905220545b92915050565b600073__Validate______________________________6346f5177f6003846000604051602001526040518360e060020a0281526004018083815260200182600160a060020a031681526020019250505060206040518083038186803b156100005760325a03f415610000575050604051519150505b919050565b600061051c33610496565b158061052e575061052c83610496565b155b8061053f575061053d336103ee565b155b1561054c575060006103e8565b600160a060020a03331660009081526001602052604090205482901015610575575060006103e8565b50600160a060020a0333811660009081526001602081905260408083208054869003905592851682529190208054830190555b92915050565b600160a060020a0381166000908152600160205260409020545b91905056",
    "events": {},
    "updated_at": 1482463645862
  },
  "3": {
    "abi": [
      {
        "constant": false,
        "inputs": [
          {
            "name": "_lender",
            "type": "address"
          },
          {
            "name": "_receiver",
            "type": "address"
          }
        ],
        "name": "getBalanceOfLending",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_receiver",
            "type": "address"
          },
          {
            "name": "_amount",
            "type": "uint256"
          }
        ],
        "name": "lending",
        "outputs": [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_addr",
            "type": "address"
          }
        ],
        "name": "getBalanceOfGeneral",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      }
    ],
    "unlinked_binary": "0x6060604081905260008054600160a060020a031916738f10c10406c56a7788a7ff0117016f37141237231790819055600160a060020a03169061061e806102db8339018082600160a060020a03168152602001915050604051809103906000f080156100005760018054600160a060020a0319166c010000000000000000000000009283029290920491909117905534610000575b610239806100a26000396000f3606060405260e060020a600035046371dcf0578114610034578063d21ccead14610059578063dafaa27e14610080575b610000565b34610000576100476004356024356100a2565b60408051918252519081900360200190f35b346100005761006c60043560243561012f565b604080519115158252519081900360200190f35b34610000576100476004356101bb565b60408051918252519081900360200190f35b600154604080516000602091820181905282517f71dcf057000000000000000000000000000000000000000000000000000000008152600160a060020a03878116600483015286811660248301529351919493909316926371dcf05792604480830193919282900301818787803b156100005760325a03f115610000575050604051519150505b92915050565b600154604080516000602091820181905282517f4c1c85e2000000000000000000000000000000000000000000000000000000008152600160a060020a03878116600483015260248201879052935191949390931692634c1c85e292604480830193919282900301818787803b156100005760325a03f115610000575050604051519150505b92915050565b6000600160009054906101000a9004600160a060020a0316600160a060020a031663dafaa27e836000604051602001526040518260e060020a0281526004018082600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051519150505b919050566060604052346100005760405160208061061e83398101604052515b5b5b60008054600160a060020a0319166c01000000000000000000000000838102041790555b505b6105cd806100516000396000f3606060405236156100775760e060020a600035046329092d0e811461007c5780633989101d1461008e5780634420e486146100a05780634c1c85e2146100b257806350556df2146100d957806371dcf057146100fd578063a1bd281c14610122578063d0679d3414610146578063dafaa27e1461016d575b610000565b346100005761008c60043561018f565b005b346100005761008c600435610240565b005b346100005761008c600435610302565b005b34610000576100c560043560243561039f565b604080519115158252519081900360200190f35b34610000576100c56004356103ee565b604080519115158252519081900360200190f35b3461000057610110600435602435610469565b60408051918252519081900360200190f35b34610000576100c5600435610496565b604080519115158252519081900360200190f35b34610000576100c5600435602435610511565b604080519115158252519081900360200190f35b34610000576101106004356105ae565b60408051918252519081900360200190f35b60005433600160a060020a039081169116146101aa57610000565b6101b381610496565b15156101be57610000565b73__Validate______________________________6320d26d326003836000604051602001526040518360e060020a0281526004018083815260200182600160a060020a031681526020019250505060206040518083038186803b156100005760325a03f415610000575050604051511515905061023b57610000565b5b5b50565b60005433600160a060020a0390811691161461025b57610000565b61026481610496565b15806102765750610274816103ee565b155b1561028057610000565b73__Validate______________________________636d16738a6004836000604051602001526040518360e060020a0281526004018083815260200182600160a060020a031681526020019250505060206040518083038186803b156100005760325a03f415610000575050604051511515905061023b57610000565b5b5b50565b60005433600160a060020a0390811691161461031d57610000565b73__Validate______________________________636d16738a6003836000604051602001526040518360e060020a0281526004018083815260200182600160a060020a031681526020019250505060206040518083038186803b156100005760325a03f415610000575050604051511515905061023b57610000565b5b5b50565b60006103ab8383610511565b15156103b9575060006103e8565b50600160a060020a03338116600090815260026020908152604080832093861683529290522080548201905560015b92915050565b600073__Validate______________________________6346f5177f6004846000604051602001526040518360e060020a0281526004018083815260200182600160a060020a031681526020019250505060206040518083038186803b156100005760325a03f415610000575050604051519150505b919050565b600160a060020a038083166000908152600260209081526040808320938516835292905220545b92915050565b600073__Validate______________________________6346f5177f6003846000604051602001526040518360e060020a0281526004018083815260200182600160a060020a031681526020019250505060206040518083038186803b156100005760325a03f415610000575050604051519150505b919050565b600061051c33610496565b158061052e575061052c83610496565b155b8061053f575061053d336103ee565b155b1561054c575060006103e8565b600160a060020a03331660009081526001602052604090205482901015610575575060006103e8565b50600160a060020a0333811660009081526001602081905260408083208054869003905592851682529190208054830190555b92915050565b600160a060020a0381166000908152600160205260409020545b91905056",
    "events": {},
    "updated_at": 1482464300878
  },
  "123456": {
    "abi": [
      {
        "constant": false,
        "inputs": [
          {
            "name": "_lender",
            "type": "address"
          },
          {
            "name": "_receiver",
            "type": "address"
          }
        ],
        "name": "getBalanceOfLending",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_receiver",
            "type": "address"
          },
          {
            "name": "_amount",
            "type": "uint256"
          }
        ],
        "name": "lending",
        "outputs": [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_addr",
            "type": "address"
          }
        ],
        "name": "getBalanceOfGeneral",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      }
    ],
    "unlinked_binary": "0x6060604081905260008054600160a060020a031916738f10c10406c56a7788a7ff0117016f37141237231790819055600160a060020a03169061061e806102db8339018082600160a060020a03168152602001915050604051809103906000f080156100005760018054600160a060020a0319166c010000000000000000000000009283029290920491909117905534610000575b610239806100a26000396000f3606060405260e060020a600035046371dcf0578114610034578063d21ccead14610059578063dafaa27e14610080575b610000565b34610000576100476004356024356100a2565b60408051918252519081900360200190f35b346100005761006c60043560243561012f565b604080519115158252519081900360200190f35b34610000576100476004356101bb565b60408051918252519081900360200190f35b600154604080516000602091820181905282517f71dcf057000000000000000000000000000000000000000000000000000000008152600160a060020a03878116600483015286811660248301529351919493909316926371dcf05792604480830193919282900301818787803b156100005760325a03f115610000575050604051519150505b92915050565b600154604080516000602091820181905282517f4c1c85e2000000000000000000000000000000000000000000000000000000008152600160a060020a03878116600483015260248201879052935191949390931692634c1c85e292604480830193919282900301818787803b156100005760325a03f115610000575050604051519150505b92915050565b6000600160009054906101000a9004600160a060020a0316600160a060020a031663dafaa27e836000604051602001526040518260e060020a0281526004018082600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051519150505b919050566060604052346100005760405160208061061e83398101604052515b5b5b60008054600160a060020a0319166c01000000000000000000000000838102041790555b505b6105cd806100516000396000f3606060405236156100775760e060020a600035046329092d0e811461007c5780633989101d1461008e5780634420e486146100a05780634c1c85e2146100b257806350556df2146100d957806371dcf057146100fd578063a1bd281c14610122578063d0679d3414610146578063dafaa27e1461016d575b610000565b346100005761008c60043561018f565b005b346100005761008c600435610240565b005b346100005761008c600435610302565b005b34610000576100c560043560243561039f565b604080519115158252519081900360200190f35b34610000576100c56004356103ee565b604080519115158252519081900360200190f35b3461000057610110600435602435610469565b60408051918252519081900360200190f35b34610000576100c5600435610496565b604080519115158252519081900360200190f35b34610000576100c5600435602435610511565b604080519115158252519081900360200190f35b34610000576101106004356105ae565b60408051918252519081900360200190f35b60005433600160a060020a039081169116146101aa57610000565b6101b381610496565b15156101be57610000565b73__Validate______________________________6320d26d326003836000604051602001526040518360e060020a0281526004018083815260200182600160a060020a031681526020019250505060206040518083038186803b156100005760325a03f415610000575050604051511515905061023b57610000565b5b5b50565b60005433600160a060020a0390811691161461025b57610000565b61026481610496565b15806102765750610274816103ee565b155b1561028057610000565b73__Validate______________________________636d16738a6004836000604051602001526040518360e060020a0281526004018083815260200182600160a060020a031681526020019250505060206040518083038186803b156100005760325a03f415610000575050604051511515905061023b57610000565b5b5b50565b60005433600160a060020a0390811691161461031d57610000565b73__Validate______________________________636d16738a6003836000604051602001526040518360e060020a0281526004018083815260200182600160a060020a031681526020019250505060206040518083038186803b156100005760325a03f415610000575050604051511515905061023b57610000565b5b5b50565b60006103ab8383610511565b15156103b9575060006103e8565b50600160a060020a03338116600090815260026020908152604080832093861683529290522080548201905560015b92915050565b600073__Validate______________________________6346f5177f6004846000604051602001526040518360e060020a0281526004018083815260200182600160a060020a031681526020019250505060206040518083038186803b156100005760325a03f415610000575050604051519150505b919050565b600160a060020a038083166000908152600260209081526040808320938516835292905220545b92915050565b600073__Validate______________________________6346f5177f6003846000604051602001526040518360e060020a0281526004018083815260200182600160a060020a031681526020019250505060206040518083038186803b156100005760325a03f415610000575050604051519150505b919050565b600061051c33610496565b158061052e575061052c83610496565b155b8061053f575061053d336103ee565b155b1561054c575060006103e8565b600160a060020a03331660009081526001602052604090205482901015610575575060006103e8565b50600160a060020a0333811660009081526001602081905260408083208054869003905592851682529190208054830190555b92915050565b600160a060020a0381166000908152600160205260409020545b91905056",
    "events": {},
    "updated_at": 1482463686714
  },
  "default": {
    "abi": [
      {
        "constant": false,
        "inputs": [
          {
            "name": "_lender",
            "type": "address"
          },
          {
            "name": "_receiver",
            "type": "address"
          }
        ],
        "name": "getBalanceOfLending",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_receiver",
            "type": "address"
          },
          {
            "name": "_amount",
            "type": "uint256"
          }
        ],
        "name": "lending",
        "outputs": [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_addr",
            "type": "address"
          }
        ],
        "name": "getBalanceOfGeneral",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      }
    ],
    "unlinked_binary": "0x6060604081905260008054600160a060020a031916738f10c10406c56a7788a7ff0117016f37141237231790819055600160a060020a0316906106c5806103298339600160a060020a03909216910190815260405190819003602001906000f080156100005760018054600160a060020a031916600160a060020a039290921691909117905534610000575b61028f8061009a6000396000f300606060405263ffffffff60e060020a60003504166371dcf057811461003a578063d21ccead1461006b578063dafaa27e1461009b575b610000565b3461000057610059600160a060020a03600435811690602435166100c6565b60408051918252519081900360200190f35b3461000057610087600160a060020a0360043516602435610153565b604080519115158252519081900360200190f35b3461000057610059600160a060020a03600435166101df565b60408051918252519081900360200190f35b600154604080516000602091820181905282517f71dcf057000000000000000000000000000000000000000000000000000000008152600160a060020a03878116600483015286811660248301529351919493909316926371dcf05792604480830193919282900301818787803b156100005760325a03f115610000575050604051519150505b92915050565b600154604080516000602091820181905282517f4c1c85e2000000000000000000000000000000000000000000000000000000008152600160a060020a03878116600483015260248201879052935191949390931692634c1c85e292604480830193919282900301818787803b156100005760325a03f115610000575050604051519150505b92915050565b600154604080516000602091820181905282517fdafaa27e000000000000000000000000000000000000000000000000000000008152600160a060020a03868116600483015293519194939093169263dafaa27e92602480830193919282900301818787803b156100005760325a03f115610000575050604051519150505b9190505600a165627a7a723058205b9d271d091efadca55031235302f8360e1984b2ce8e7970d58defd43d0a37240029606060405234610000576040516020806106c583398101604052515b5b5b60008054600160a060020a031916600160a060020a0383161790555b505b61067b8061004a6000396000f3006060604052361561007d5763ffffffff60e060020a60003504166329092d0e81146100825780633989101d1461009d5780634420e486146100b85780634c1c85e2146100d357806350556df21461010357806371dcf05714610130578063a1bd281c14610161578063d0679d341461018e578063dafaa27e146101be575b610000565b346100005761009b600160a060020a03600435166101e9565b005b346100005761009b600160a060020a03600435166102b4565b005b346100005761009b600160a060020a0360043516610379565b005b34610000576100ef600160a060020a036004351660243561041a565b604080519115158252519081900360200190f35b34610000576100ef600160a060020a0360043516610469565b604080519115158252519081900360200190f35b346100005761014f600160a060020a03600435811690602435166104e7565b60408051918252519081900360200190f35b34610000576100ef600160a060020a0360043516610514565b604080519115158252519081900360200190f35b34610000576100ef600160a060020a0360043516602435610593565b604080519115158252519081900360200190f35b346100005761014f600160a060020a0360043516610630565b60408051918252519081900360200190f35b60005433600160a060020a0390811691161461020457610000565b61020d81610514565b151561021857610000565b60408051600060209182015281517f20d26d3200000000000000000000000000000000000000000000000000000000815260036004820152600160a060020a0384166024820152915173__Validate______________________________926320d26d32926044808301939192829003018186803b156100005760325a03f41561000057505060405151151590506102af57610000565b5b5b50565b60005433600160a060020a039081169116146102cf57610000565b6102d881610514565b15806102ea57506102e881610469565b155b156102f457610000565b604080516000602091820152815160e160020a63368b39c5028152600481810152600160a060020a0384166024820152915173__Validate______________________________92636d16738a926044808301939192829003018186803b156100005760325a03f41561000057505060405151151590506102af57610000565b5b5b50565b60005433600160a060020a0390811691161461039457610000565b604080516000602091820152815160e160020a63368b39c502815260036004820152600160a060020a0384166024820152915173__Validate______________________________92636d16738a926044808301939192829003018186803b156100005760325a03f41561000057505060405151151590506102af57610000565b5b5b50565b60006104268383610593565b151561043457506000610463565b50600160a060020a03338116600090815260026020908152604080832093861683529290522080548201905560015b92915050565b6040805160006020918201819052825160e060020a6346f5177f028152600481810152600160a060020a03851660248201529251909273__Validate______________________________926346f5177f92604480840193829003018186803b156100005760325a03f415610000575050604051519150505b919050565b600160a060020a038083166000908152600260209081526040808320938516835292905220545b92915050565b6040805160006020918201819052825160e060020a6346f5177f02815260036004820152600160a060020a03851660248201529251909273__Validate______________________________926346f5177f92604480840193829003018186803b156100005760325a03f415610000575050604051519150505b919050565b600061059e33610514565b15806105b057506105ae83610514565b155b806105c157506105bf33610469565b155b156105ce57506000610463565b600160a060020a033316600090815260016020526040902054829010156105f757506000610463565b50600160a060020a0333811660009081526001602081905260408083208054869003905592851682529190208054830190555b92915050565b600160a060020a0381166000908152600160205260409020545b9190505600a165627a7a72305820511d7a5d7cec376053c2505a65bb273a694c42c4ce2fce085c330858b50ce45c0029",
    "events": {},
    "updated_at": 1483253011601,
    "links": {
      "Validate": "0xabc51b5cee8be8b97d2e9631c5919e4488411126"
    },
    "address": "0x8f8287be23faa4eda76d0045b123660d2b79d23d"
  }
};

  Contract.checkNetwork = function(callback) {
    var self = this;

    if (this.network_id != null) {
      return callback();
    }

    this.web3.version.network(function(err, result) {
      if (err) return callback(err);

      var network_id = result.toString();

      // If we have the main network,
      if (network_id == "1") {
        var possible_ids = ["1", "live", "default"];

        for (var i = 0; i < possible_ids.length; i++) {
          var id = possible_ids[i];
          if (Contract.all_networks[id] != null) {
            network_id = id;
            break;
          }
        }
      }

      if (self.all_networks[network_id] == null) {
        return callback(new Error(self.name + " error: Can't find artifacts for network id '" + network_id + "'"));
      }

      self.setNetwork(network_id);
      callback();
    })
  };

  Contract.setNetwork = function(network_id) {
    var network = this.all_networks[network_id] || {};

    this.abi             = this.prototype.abi             = network.abi;
    this.unlinked_binary = this.prototype.unlinked_binary = network.unlinked_binary;
    this.address         = this.prototype.address         = network.address;
    this.updated_at      = this.prototype.updated_at      = network.updated_at;
    this.links           = this.prototype.links           = network.links || {};
    this.events          = this.prototype.events          = network.events || {};

    this.network_id = network_id;
  };

  Contract.networks = function() {
    return Object.keys(this.all_networks);
  };

  Contract.link = function(name, address) {
    if (typeof name == "function") {
      var contract = name;

      if (contract.address == null) {
        throw new Error("Cannot link contract without an address.");
      }

      Contract.link(contract.contract_name, contract.address);

      // Merge events so this contract knows about library's events
      Object.keys(contract.events).forEach(function(topic) {
        Contract.events[topic] = contract.events[topic];
      });

      return;
    }

    if (typeof name == "object") {
      var obj = name;
      Object.keys(obj).forEach(function(name) {
        var a = obj[name];
        Contract.link(name, a);
      });
      return;
    }

    Contract.links[name] = address;
  };

  Contract.contract_name   = Contract.prototype.contract_name   = "EtherBank";
  Contract.generated_with  = Contract.prototype.generated_with  = "3.2.0";

  // Allow people to opt-in to breaking changes now.
  Contract.next_gen = false;

  var properties = {
    binary: function() {
      var binary = Contract.unlinked_binary;

      Object.keys(Contract.links).forEach(function(library_name) {
        var library_address = Contract.links[library_name];
        var regex = new RegExp("__" + library_name + "_*", "g");

        binary = binary.replace(regex, library_address.replace("0x", ""));
      });

      return binary;
    }
  };

  Object.keys(properties).forEach(function(key) {
    var getter = properties[key];

    var definition = {};
    definition.enumerable = true;
    definition.configurable = false;
    definition.get = getter;

    Object.defineProperty(Contract, key, definition);
    Object.defineProperty(Contract.prototype, key, definition);
  });

  bootstrap(Contract);

  if (typeof module != "undefined" && typeof module.exports != "undefined") {
    module.exports = Contract;
  } else {
    // There will only be one version of this contract in the browser,
    // and we can use that.
    window.EtherBank = Contract;
  }
})();
