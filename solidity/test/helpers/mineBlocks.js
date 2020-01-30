/**
 *  Mines specific number of blocks.
 *  @param blocks Number of blocks to mine.
 */
async function mineBlocks(blocks) {
    for (let i = 0; i < blocks; i++) {
        web3.currentProvider.send({
            jsonrpc: "2.0",
            method: "evm_mine",
            id: 12345
        }, function (err, _) {
            if (err) console.log("Error mining a block.")
        });
    }
}

export {
    mineBlocks,
};
