const KeepBond = artifacts.require('./KeepBond.sol')

const { expectRevert } = require('openzeppelin-test-helpers');

const BN = web3.utils.BN

const chai = require('chai')
chai.use(require('bn-chai')(BN))
const expect = chai.expect

contract('KeepBond', (accounts) => {
    let keepBond

    before(async () => {
        keepBond = await KeepBond.new()
    })

    describe('deposit', async () => {
        it('registers pot', async () => {
            const account = accounts[1]
            const value = new BN(100)

            const expectedPot = (await keepBond.availableForBonding(account)).add(value)

            await keepBond.deposit({ from: account, value: value })

            const pot = await keepBond.availableForBonding(account)

            expect(pot).to.eq.BN(expectedPot, 'invalid pot')
        })
    })

    describe('withdraw', async () => {
        const account = accounts[1]
        const destination = accounts[2]

        before(async () => {
            const value = new BN(100)
            await keepBond.deposit({ from: account, value: value })
        })

        it('transfers value', async () => {
            const value = (await keepBond.availableForBonding(account))

            const expectedPot = (await keepBond.availableForBonding(account)).sub(value)
            const expectedDestinationBalance = web3.utils.toBN(await web3.eth.getBalance(destination)).add(value)

            await keepBond.withdraw(value, destination, { from: account })

            const pot = await keepBond.availableForBonding(account)
            expect(pot).to.eq.BN(expectedPot, 'invalid pot')

            const destinationBalance = await web3.eth.getBalance(destination)
            expect(destinationBalance).to.eq.BN(expectedDestinationBalance, 'invalid destination balance')
        })

        it('fails if insufficient pot', async () => {
            const value = (await keepBond.availableForBonding(account)).add(new BN(1))

            await expectRevert(
                keepBond.withdraw(value, destination, { from: account }),
                "Insufficient pot"
            )
        })
    })

    describe('availableForBonding', async () => {
        const account = accounts[1]
        const value = new BN(100)

        before(async () => {
            await keepBond.deposit({ from: account, value: value })
        })

        it('returns zero for not deposited operator', async () => {
            const operator = "0x0000000000000000000000000000000000000001"
            const expectedPot = 0

            const pot = await keepBond.availableForBonding(operator)

            expect(pot).to.eq.BN(expectedPot, 'invalid pot')
        })

        it('returns value of operators deposit', async () => {
            const operator = account
            const expectedPot = value

            const pot = await keepBond.availableForBonding(operator)

            expect(pot).to.eq.BN(expectedPot, 'invalid pot')
        })
    })
})
