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
      throw new Error("Validate error: Please call setProvider() first before calling new().");
    }

    var args = Array.prototype.slice.call(arguments);

    if (!this.unlinked_binary) {
      throw new Error("Validate error: contract binary not set. Can't deploy new instance.");
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

      throw new Error("Validate contains unresolved libraries. You must deploy and link the following libraries before you can deploy a new version of Validate: " + unlinked_libraries);
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
      throw new Error("Invalid address passed to Validate.at(): " + address);
    }

    var contract_class = this.web3.eth.contract(this.abi);
    var contract = contract_class.at(address);

    return new this(contract);
  };

  Contract.deployed = function() {
    if (!this.address) {
      throw new Error("Cannot find deployed address: Validate not deployed or address not set.");
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
            "name": "self",
            "type": "Validate.Data storage"
          },
          {
            "name": "value",
            "type": "address"
          }
        ],
        "name": "remove",
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
            "name": "self",
            "type": "Validate.Data storage"
          },
          {
            "name": "value",
            "type": "address"
          }
        ],
        "name": "show",
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
            "name": "self",
            "type": "Validate.Data storage"
          },
          {
            "name": "value",
            "type": "address"
          }
        ],
        "name": "insert",
        "outputs": [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      }
    ],
    "unlinked_binary": "0x606060405234610000575b610184806100186000396000f36504062dabbdf050606060405260e060020a600035046320d26d32811461003c57806346f5177f1461005e5780636d16738a14610080575b610000565b61004a6004356024356100a2565b604080519115158252519081900360200190f35b61004a6004356024356100f6565b604080519115158252519081900360200190f35b61004a60043560243561012d565b604080519115158252519081900360200190f35b600160a060020a03811660009081526020839052604081205460ff1615156100cc575060006100f0565b50600160a060020a0381166000908152602083905260409020805460ff1916905560015b92915050565b600160a060020a03811660009081526020839052604081205460ff161515600114610123575060006100f0565b5060015b92915050565b600160a060020a03811660009081526020839052604081205460ff1615610156575060006100f0565b50600160a060020a0381166000908152602083905260409020805460ff191660019081179091555b9291505056",
    "events": {},
    "updated_at": 1482463645912
  },
  "3": {
    "abi": [
      {
        "constant": false,
        "inputs": [
          {
            "name": "self",
            "type": "Validate.Data storage"
          },
          {
            "name": "value",
            "type": "address"
          }
        ],
        "name": "remove",
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
            "name": "self",
            "type": "Validate.Data storage"
          },
          {
            "name": "value",
            "type": "address"
          }
        ],
        "name": "show",
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
            "name": "self",
            "type": "Validate.Data storage"
          },
          {
            "name": "value",
            "type": "address"
          }
        ],
        "name": "insert",
        "outputs": [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      }
    ],
    "unlinked_binary": "0x606060405234610000575b610184806100186000396000f36504062dabbdf050606060405260e060020a600035046320d26d32811461003c57806346f5177f1461005e5780636d16738a14610080575b610000565b61004a6004356024356100a2565b604080519115158252519081900360200190f35b61004a6004356024356100f6565b604080519115158252519081900360200190f35b61004a60043560243561012d565b604080519115158252519081900360200190f35b600160a060020a03811660009081526020839052604081205460ff1615156100cc575060006100f0565b50600160a060020a0381166000908152602083905260409020805460ff1916905560015b92915050565b600160a060020a03811660009081526020839052604081205460ff161515600114610123575060006100f0565b5060015b92915050565b600160a060020a03811660009081526020839052604081205460ff1615610156575060006100f0565b50600160a060020a0381166000908152602083905260409020805460ff191660019081179091555b9291505056",
    "events": {},
    "updated_at": 1482464300899
  },
  "123456": {
    "abi": [
      {
        "constant": false,
        "inputs": [
          {
            "name": "self",
            "type": "Validate.Data storage"
          },
          {
            "name": "value",
            "type": "address"
          }
        ],
        "name": "remove",
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
            "name": "self",
            "type": "Validate.Data storage"
          },
          {
            "name": "value",
            "type": "address"
          }
        ],
        "name": "show",
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
            "name": "self",
            "type": "Validate.Data storage"
          },
          {
            "name": "value",
            "type": "address"
          }
        ],
        "name": "insert",
        "outputs": [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      }
    ],
    "unlinked_binary": "0x606060405234610000575b610184806100186000396000f36504062dabbdf050606060405260e060020a600035046320d26d32811461003c57806346f5177f1461005e5780636d16738a14610080575b610000565b61004a6004356024356100a2565b604080519115158252519081900360200190f35b61004a6004356024356100f6565b604080519115158252519081900360200190f35b61004a60043560243561012d565b604080519115158252519081900360200190f35b600160a060020a03811660009081526020839052604081205460ff1615156100cc575060006100f0565b50600160a060020a0381166000908152602083905260409020805460ff1916905560015b92915050565b600160a060020a03811660009081526020839052604081205460ff161515600114610123575060006100f0565b5060015b92915050565b600160a060020a03811660009081526020839052604081205460ff1615610156575060006100f0565b50600160a060020a0381166000908152602083905260409020805460ff191660019081179091555b9291505056",
    "events": {},
    "updated_at": 1482463686764
  },
  "default": {
    "abi": [
      {
        "constant": false,
        "inputs": [
          {
            "name": "self",
            "type": "Validate.Data storage"
          },
          {
            "name": "value",
            "type": "address"
          }
        ],
        "name": "remove",
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
            "name": "self",
            "type": "Validate.Data storage"
          },
          {
            "name": "value",
            "type": "address"
          }
        ],
        "name": "show",
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
            "name": "self",
            "type": "Validate.Data storage"
          },
          {
            "name": "value",
            "type": "address"
          }
        ],
        "name": "insert",
        "outputs": [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      }
    ],
    "unlinked_binary": "0x606060405234610000575b6101c9806100196000396000f300606060405263ffffffff60e060020a60003504166320d26d32811461003a57806346f5177f146100655780636d16738a14610090575b610000565b610051600435600160a060020a03602435166100bb565b604080519115158252519081900360200190f35b610051600435600160a060020a036024351661010f565b604080519115158252519081900360200190f35b610051600435600160a060020a0360243516610146565b604080519115158252519081900360200190f35b600160a060020a03811660009081526020839052604081205460ff1615156100e557506000610109565b50600160a060020a0381166000908152602083905260409020805460ff1916905560015b92915050565b600160a060020a03811660009081526020839052604081205460ff16151560011461013c57506000610109565b5060015b92915050565b600160a060020a03811660009081526020839052604081205460ff161561016f57506000610109565b50600160a060020a0381166000908152602083905260409020805460ff191660019081179091555b929150505600a165627a7a723058208692495faef806404506138730d0234277acc2214ebb35ad9ac3d29f367cfc5c0029",
    "events": {},
    "updated_at": 1483253011618,
    "links": {},
    "address": "0xabc51b5cee8be8b97d2e9631c5919e4488411126"
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

  Contract.contract_name   = Contract.prototype.contract_name   = "Validate";
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
    window.Validate = Contract;
  }
})();
