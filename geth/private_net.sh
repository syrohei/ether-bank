#!/bin/bash -x

# Generate and store a wallet password
if [ ! -f ~/.accountpassword ]; then
  echo `date +%s | sha256sum | base64 | head -c 32` > ~/.accountpassword
fi

if [ ! -f ~/.primaryaccount ]; then
  geth --testnet --password ~/.accountpassword account new > ~/.primaryaccount
fi

geth --rpc --networkid 123456 --nodiscover --maxpeers 0  --rpcaddr "0.0.0.0" --rpccorsdomain "*" --testnet --password ~/.accountpassword --mine --minerthreads 1 --extradata "syrohei"
