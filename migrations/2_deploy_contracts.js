module.exports = function(deployer) {
  deployer.deploy(Validate);
  deployer.autolink();
  deployer.deploy(EtherBank);
};
