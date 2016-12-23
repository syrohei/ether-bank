module.exports = {
  build: {
    "index.html": "index.html",
    "app.js": [
      "javascripts/app.js"
    ],
    "app.css": [
      "stylesheets/app.css"
    ],
    "images/": "images/"
  },
  rpc: {
    host: "localhost",   //testrpc
    port: 8545
  },
  networks: {
    "mainnet": {
      network_id: 1, // Ethereum public network
      host: "localhost", // Random IP for example purposes (do not use)
      port: 8548,
      gas: 3712388
        // optional config values
        // host - defaults to "localhost"
        // port - defaults to 8545
        // gas
        // gasPrice
        // from - default address to use for any transaction Truffle makes during migrations
    },
    "testnet": {
      network_id: 2, // Official Ethereum test network
      host: "localhost",
      port: 8553,
      gas: 3712388
    },
    "privatenet": {
      network_id: 123456, // custom private network
      host: "localhost",
      port: 8557,
      gas: 3712388
        // use default rpc settings
    }
  }
};
