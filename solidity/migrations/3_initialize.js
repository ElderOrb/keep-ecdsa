const ECDSAKeepFactory = artifacts.require("ECDSAKeepFactory")
const truffleContract = require("@truffle/contract")

let { RegistryAddress } = require('./external-contracts')

module.exports = async function (deployer, network) {
    await ECDSAKeepFactory.deployed()

    let registry
    if (process.env.TEST) {
        RegistryStub = artifacts.require("RegistryStub")
        registry = await RegistryStub.new()
    } else {
        // Read compiled contract artifact from 
        const registryJSON = require('@keep-network/keep-core/build/truffle/Registry.json')
        const Registry = truffleContract(registryJSON)
        Registry.setProvider(web3.currentProvider);

        registry = await Registry.at(RegistryAddress)
    }

    await registry.approveOperatorContract(
        ECDSAKeepFactory.address,
        { from: deployer.networks[network].from }
    )

    console.log(`approved operator contract [${ECDSAKeepFactory.address}] in registry`)
}
