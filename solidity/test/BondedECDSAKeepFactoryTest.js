import { createSnapshot, restoreSnapshot } from "./helpers/snapshot";

const { expectRevert } = require('openzeppelin-test-helpers')

import { mineBlocks } from './helpers/mineBlocks'
import { getETHBalancesFromList, getETHBalancesMap, addToBalances, addToBalancesMap } from './helpers/listBalanceUtils'

const truffleAssert = require('truffle-assertions')

const Registry = artifacts.require('Registry');
const BondedECDSAKeepFactoryStub = artifacts.require('BondedECDSAKeepFactoryStub');
const KeepBonding = artifacts.require('KeepBonding');
const TokenStakingStub = artifacts.require("TokenStakingStub")
const BondedSortitionPool = artifacts.require('BondedSortitionPool');
const BondedSortitionPoolFactory = artifacts.require('BondedSortitionPoolFactory');
const RandomBeaconStub = artifacts.require('RandomBeaconStub')
const BondedECDSAKeep = artifacts.require('BondedECDSAKeep')
const BondedECDSAKeepStub = artifacts.require('BondedECDSAKeepStub')

const BN = web3.utils.BN

const chai = require('chai')
chai.use(require('bn-chai')(BN))
const expect = chai.expect

contract("BondedECDSAKeepFactory", async accounts => {
    let registry
    let tokenStaking
    let keepFactory
    let bondedSortitionPoolFactory
    let keepBonding
    let randomBeacon
    let signerPool
    let minimumStake

    const application = accounts[1]
    const members = [accounts[2], accounts[3], accounts[4]]
    const authorizers = [members[0], members[1], members[2]]

    const keepOwner = accounts[5]

    const groupSize = new BN(members.length)
    const threshold = groupSize

    const singleBond = new BN(1)
    const bond = singleBond.mul(groupSize)

    describe("registerMemberCandidate", async () => {
        before(async () => {
            await initializeNewFactory()
            await initializeMemberCandidates()
        })

        beforeEach(async () => {
            await createSnapshot()
        })

        afterEach(async () => {
            await restoreSnapshot()
        })

        it("inserts operator with the correct staking weight in the pool", async () => {
            const minimumStakeMultiplier = new BN("10")
            await stakeOperators(members, minimumStake.mul(minimumStakeMultiplier))

            await keepFactory.registerMemberCandidate(application, { from: members[0] })

            const pool = await BondedSortitionPool.at(signerPool)
            const actualWeight = await pool.getPoolWeight.call(members[0])
            const expectedWeight = minimumStakeMultiplier

            expect(actualWeight).to.eq.BN(expectedWeight, 'invalid staking weight')
        })

        it("inserts operators to the same pool", async () => {
            await keepFactory.registerMemberCandidate(application, { from: members[0] })
            await keepFactory.registerMemberCandidate(application, { from: members[1] })

            const pool = await BondedSortitionPool.at(signerPool)
            assert.isTrue(await pool.isOperatorInPool(members[0]), "operator 1 is not in the pool")
            assert.isTrue(await pool.isOperatorInPool(members[1]), "operator 2 is not in the pool")
        })

        it("does not add an operator to the pool if it is already there", async () => {
            await keepFactory.registerMemberCandidate(application, { from: members[0] })

            const pool = await BondedSortitionPool.at(signerPool)

            assert.isTrue(await pool.isOperatorInPool(members[0]), "operator is not in the pool")

            await keepFactory.registerMemberCandidate(application, { from: members[0] })

            assert.isTrue(await pool.isOperatorInPool(members[0]), "operator is not in the pool")
        })

        it("does not add an operator to the pool if it does not have a minimum stake", async () => {
            await stakeOperators(members, new BN("1"))

            await expectRevert(
                keepFactory.registerMemberCandidate(application, { from: members[0] }),
                "Operator not eligible"
            )
        })

        it("does not add an operator to the pool if it does not have a minimum bond", async () => {
            const minimumBond = await keepFactory.minimumBond.call()
            const availableUnbonded = await keepBonding.availableUnbondedValue(members[0], keepFactory.address, signerPool)
            const withdrawValue = availableUnbonded.sub(minimumBond).add(new BN(1))
            await keepBonding.withdraw(withdrawValue, members[0], { from: members[0] })

            await expectRevert(
                keepFactory.registerMemberCandidate(application, { from: members[0] }),
                "Operator not eligible"
            )
        })

        it("inserts operators to different pools", async () => {
            const application1 = '0x0000000000000000000000000000000000000001'
            const application2 = '0x0000000000000000000000000000000000000002'

            let signerPool1Address = await keepFactory.createSortitionPool.call(application1)
            await keepFactory.createSortitionPool(application1)
            let signerPool2Address = await keepFactory.createSortitionPool.call(application2)
            await keepFactory.createSortitionPool(application2)

            await keepBonding.authorizeSortitionPoolContract(members[0], signerPool1Address, { from: authorizers[0] })
            await keepBonding.authorizeSortitionPoolContract(members[1], signerPool2Address, { from: authorizers[1] })

            await keepFactory.registerMemberCandidate(application1, { from: members[0] })
            await keepFactory.registerMemberCandidate(application2, { from: members[1] })

            const signerPool1 = await BondedSortitionPool.at(signerPool1Address)

            assert.isTrue(await signerPool1.isOperatorInPool(members[0]), "operator 1 is not in the pool")
            assert.isFalse(await signerPool1.isOperatorInPool(members[1]), "operator 2 is in the pool")

            const signerPool2 = await BondedSortitionPool.at(signerPool2Address)

            assert.isFalse(await signerPool2.isOperatorInPool(members[0]), "operator 1 is in the pool")
            assert.isTrue(await signerPool2.isOperatorInPool(members[1]), "operator 2 is not in the pool")
        })
    })

    describe("createSortitionPool", async () => {
        before(async () => {
            await initializeNewFactory()
        })

        beforeEach(async () => {
            await createSnapshot()
        })

        afterEach(async () => {
            await restoreSnapshot()
        })

        it("creates new sortition pool and emits an event", async () => {
            const sortitionPoolAddress = await keepFactory.createSortitionPool.call(application)

            const res = await keepFactory.createSortitionPool(application)
            truffleAssert.eventEmitted(
                res,
                'SortitionPoolCreated',
                { application: application, sortitionPool: sortitionPoolAddress }
            )
        })

        it("reverts when sortition pool already exists", async () => {
            await keepFactory.createSortitionPool(application)

            await expectRevert(
                keepFactory.createSortitionPool(application),
                'Sortition pool already exists'
            )
        })
    })

    describe("getSortitionPool", async () => {
        before(async () => {
            await initializeNewFactory()
        })

        beforeEach(async () => {
            await createSnapshot()
        })

        afterEach(async () => {
            await restoreSnapshot()
        })

        it("returns address of sortition pool", async () => {
            const sortitionPoolAddress = await keepFactory.createSortitionPool.call(application)
            await keepFactory.createSortitionPool(application)

            const result = await keepFactory.getSortitionPool(application)
            assert.equal(result, sortitionPoolAddress, 'incorrect sortition pool address')
        })

        it("reverts if sortition pool does not exist", async () => {
            await expectRevert(
                keepFactory.getSortitionPool(application),
                'No pool found for the application'
            )
        })
    })

    describe("isOperatorRegistered", async () => {
        before(async () => {
            await initializeNewFactory()
            await initializeMemberCandidates()
        })

        beforeEach(async () => {
            await createSnapshot()
        })

        afterEach(async () => {
            await restoreSnapshot()
        })

        it("returns true if the operator is registered for the application", async () => {
            await keepFactory.registerMemberCandidate(application, { from: members[0] })

            assert.isTrue(await keepFactory.isOperatorRegistered(members[0], application))
        })

        it("returns false if the operator is registered for another application", async () => {
            const application2 = '0x0000000000000000000000000000000000000002'

            await keepFactory.registerMemberCandidate(application, { from: members[0] })

            assert.isFalse(await keepFactory.isOperatorRegistered(members[0], application2))
        })

        it("returns false if the operator is not registered for any application", async () => {
            assert.isFalse(await keepFactory.isOperatorRegistered(members[0], application))
        })
    })

    describe("isOperatorUpToDate", async () => {
        before(async () => {
            await initializeNewFactory()
            await initializeMemberCandidates()
            await registerMemberCandidates()
        })

        beforeEach(async () => {
            await createSnapshot()
        })

        afterEach(async () => {
            await restoreSnapshot()
        })

        it("returns true if the operator is up to date for the application", async () => {
            await keepFactory.registerMemberCandidate(application, { from: members[0] })

            assert.isTrue(await keepFactory.isOperatorUpToDate(members[0], application))
        })

        it("returns false if the operator stake is below minimum", async () => {
            await keepFactory.registerMemberCandidate(application, { from: members[0] })

            await stakeOperators(members, minimumStake.subn(1))

            assert.isFalse(await keepFactory.isOperatorUpToDate(members[0], application))
        })

        it("returns true if the operator stake changed insufficiently", async () => {
            await keepFactory.registerMemberCandidate(application, { from: members[0] })

            // We multiply minimumStake as sortition pools expect multiplies of the
            // minimum stake to calculate stakers weight for eligibility.
            // We subtract 1 to get the same staking weight which is calculated as
            // `weight = floor(stakingBalance / minimumStake)`.
            await stakeOperators(members, minimumStake.mul(new BN(2)).sub(new BN(1)))

            assert.isTrue(await keepFactory.isOperatorUpToDate(members[0], application))
        })

        it("returns false if the operator stake is above minimum", async () => {
            await keepFactory.registerMemberCandidate(application, { from: members[0] })

            // We multiply minimumStake as sortition pools expect multiplies of the
            // minimum stake to calculate stakers weight for eligibility.
            await stakeOperators(members, minimumStake.mul(new BN(2)))

            assert.isFalse(await keepFactory.isOperatorUpToDate(members[0], application))
        })

        it("returns false if the operator bonding value is below minimum", async () => {
            await keepFactory.registerMemberCandidate(application, { from: members[0] })

            await keepBonding.withdraw(new BN(1), members[0], { from: members[0] })

            assert.isFalse(await keepFactory.isOperatorUpToDate(members[0], application))
        })

        it("returns true if the operator bonding value is above minimum", async () => {
            await keepFactory.registerMemberCandidate(application, { from: members[0] })

            await keepBonding.deposit(members[0], { value: new BN(1) })

            assert.isTrue(await keepFactory.isOperatorUpToDate(members[0], application))
        })


        it("reverts if the operator is not registered for the application", async () => {
            await initializeNewFactory()
            await initializeMemberCandidates()

            await expectRevert(
                keepFactory.isOperatorUpToDate(members[0], application),
                "Operator not registered for the application"
            )
        })
    })

    describe("updateOperatorStatus", async () => {
        before(async () => {
            await initializeNewFactory()
            await initializeMemberCandidates()
            await registerMemberCandidates()
        })

        beforeEach(async () => {
            await createSnapshot()
        })

        afterEach(async () => {
            await restoreSnapshot()
        })

        it("revers if operator is up to date", async () => {
            await expectRevert(
                keepFactory.updateOperatorStatus(members[0], application),
                "Operator already up to date"
            )
        })

        it("removes operator if stake has changed below minimum", async () => {
            await stakeOperators(members, minimumStake.sub(new BN(1)))
            assert.isFalse(
                await keepFactory.isOperatorUpToDate(members[0], application),
                "unexpected status of the operator after stake change"
            )

            await keepFactory.updateOperatorStatus(members[0], application)

            await expectRevert(
                keepFactory.isOperatorUpToDate(members[0], application),
                "Operator not registered for the application"
            )
        })

        it("updates operator if stake has changed above minimum", async () => {
            // We multiply minimumStake as sortition pools expect multiplies of the
            // minimum stake to calculate stakers weight for eligibility.
            await stakeOperators(members, minimumStake.mul(new BN(2)))
            assert.isFalse(
                await keepFactory.isOperatorUpToDate(members[0], application),
                "unexpected status of the operator after stake change"
            )

            await keepFactory.updateOperatorStatus(members[0], application)

            assert.isTrue(
                await keepFactory.isOperatorUpToDate(members[0], application),
                "unexpected status of the operator after status update"
            )
        })

        it("removes operator if bonding value has changed below minimum", async () => {
            keepBonding.withdraw(new BN(1), members[0], { from: members[0] })
            assert.isFalse(
                await keepFactory.isOperatorUpToDate(members[0], application),
                "unexpected status of the operator after bonding value change"
            )

            await keepFactory.updateOperatorStatus(members[0], application)

            await expectRevert(
                keepFactory.isOperatorUpToDate(members[0], application),
                "Operator not registered for the application"
            )
        })

        it("updates operator if bonding value has changed above minimum", async () => {
            keepBonding.deposit(members[0], { value: new BN(1) })
            assert.isTrue(
                await keepFactory.isOperatorUpToDate(members[0], application),
                "unexpected status of the operator after bonding value change"
            )

            await expectRevert(
                keepFactory.updateOperatorStatus(members[0], application),
                "Operator already up to date"
            )
        })

        it("reverts if the operator is not registered for the application", async () => {
            await initializeNewFactory()
            await initializeMemberCandidates()

            await expectRevert(
                keepFactory.updateOperatorStatus(members[0], application),
                "Operator not registered for the application"
            )
        })
    })

    describe("isOperatorRegistered", async () => {
        before(async () => {
            await initializeNewFactory()
            await initializeMemberCandidates()
        })

        beforeEach(async () => {
            await createSnapshot()
        })

        afterEach(async () => {
            await restoreSnapshot()
        })

        it("returns true if the operator is registered for the application", async () => {
            await keepFactory.registerMemberCandidate(application, { from: members[0] })

            assert.isTrue(await keepFactory.isOperatorRegistered(members[0], application))
        })

        it("returns false if the operator is registered for another application", async () => {
            const application2 = '0x0000000000000000000000000000000000000002'

            await keepFactory.registerMemberCandidate(application, { from: members[0] })

            assert.isFalse(await keepFactory.isOperatorRegistered(members[0], application2))
        })

        it("returns false if the operator is not registered for any application", async () => {
            assert.isFalse(await keepFactory.isOperatorRegistered(members[0], application))
        })
    })

    describe("isOperatorUpToDate", async () => {
        before(async () => {
            await initializeNewFactory()
            await initializeMemberCandidates()
            await registerMemberCandidates()
        })

        beforeEach(async () => {
            await createSnapshot()
        })

        afterEach(async () => {
            await restoreSnapshot()
        })

        it("returns true if the operator is up to date for the application", async () => {
            await keepFactory.registerMemberCandidate(application, { from: members[0] })

            assert.isTrue(await keepFactory.isOperatorUpToDate(members[0], application))
        })

        it("returns false if the operator stake is below minimum", async () => {
            await keepFactory.registerMemberCandidate(application, { from: members[0] })

            await stakeOperators(members, minimumStake.sub(new BN(1)))

            assert.isFalse(await keepFactory.isOperatorUpToDate(members[0], application))
        })

        it("returns true if the operator stake changed insignificantly", async () => {
            await keepFactory.registerMemberCandidate(application, { from: members[0] })

            // We multiply minimumStake as sortition pools expect multiplies of the
            // minimum stake to calculate stakers weight for eligibility.
            // We subtract 1 to get the same staking weight which is calculated as
            // `weight = floor(stakingBalance / minimumStake)`.
            await stakeOperators(members, minimumStake.mul(new BN(2)).sub(new BN(1)))

            assert.isTrue(await keepFactory.isOperatorUpToDate(members[0], application))
        })

        it("returns false if the operator stake is above minimum", async () => {
            await keepFactory.registerMemberCandidate(application, { from: members[0] })

            // We multiply minimumStake as sortition pools expect multiplies of the
            // minimum stake to calculate stakers weight for eligibility.
            await stakeOperators(members, minimumStake.mul(new BN(2)))

            assert.isFalse(await keepFactory.isOperatorUpToDate(members[0], application))
        })

        it("returns false if the operator bonding value is below minimum", async () => {
            await keepFactory.registerMemberCandidate(application, { from: members[0] })

            keepBonding.withdraw(new BN(1), members[0], { from: members[0] })

            assert.isFalse(await keepFactory.isOperatorUpToDate(members[0], application))
        })

        it("returns true if the operator bonding value is above minimum", async () => {
            await keepFactory.registerMemberCandidate(application, { from: members[0] })

            keepBonding.deposit(members[0], { value: new BN(1) })

            assert.isTrue(await keepFactory.isOperatorUpToDate(members[0], application))
        })


        it("reverts if the operator is not registered for the application", async () => {
            await initializeNewFactory()
            await initializeMemberCandidates()

            await expectRevert(
                keepFactory.isOperatorUpToDate(members[0], application),
                "Operator not registered for the application"
            )
        })
    })

    describe("updateOperatorStatus", async () => {
        before(async () => {
            await initializeNewFactory()
            await initializeMemberCandidates()
            await registerMemberCandidates()
        })

        beforeEach(async () => {
            await createSnapshot()
        })

        afterEach(async () => {
            await restoreSnapshot()
        })

        it("revers if operator is up to date", async () => {
            await expectRevert(
                keepFactory.updateOperatorStatus(members[0], application),
                "Operator already up to date"
            )
        })

        it("removes operator if stake has changed below minimum", async () => {
            await stakeOperators(members, minimumStake.sub(new BN(1)))
            assert.isFalse(
                await keepFactory.isOperatorUpToDate(members[0], application),
                "unexpected status of the operator after stake change"
            )

            await keepFactory.updateOperatorStatus(members[0], application)

            await expectRevert(
                keepFactory.isOperatorUpToDate(members[0], application),
                "Operator not registered for the application"
            )
        })

        it("updates operator if stake has changed above minimum", async () => {
            // We multiply minimumStake as sortition pools expect multiplies of the
            // minimum stake to calculate stakers weight for eligibility.
            await stakeOperators(members, minimumStake.mul(new BN(2)))
            assert.isFalse(
                await keepFactory.isOperatorUpToDate(members[0], application),
                "unexpected status of the operator after stake change"
            )

            await keepFactory.updateOperatorStatus(members[0], application)

            assert.isTrue(
                await keepFactory.isOperatorUpToDate(members[0], application),
                "unexpected status of the operator after status update"
            )
        })

        it("removes operator if bonding value has changed below minimum", async () => {
            keepBonding.withdraw(new BN(1), members[0], { from: members[0] })
            assert.isFalse(
                await keepFactory.isOperatorUpToDate(members[0], application),
                "unexpected status of the operator after bonding value change"
            )

            await keepFactory.updateOperatorStatus(members[0], application)

            await expectRevert(
                keepFactory.isOperatorUpToDate(members[0], application),
                "Operator not registered for the application"
            )
        })

        it("updates operator if bonding value has changed above minimum", async () => {
            keepBonding.deposit(members[0], { value: new BN(1) })
            assert.isTrue(
                await keepFactory.isOperatorUpToDate(members[0], application),
                "unexpected status of the operator after bonding value change"
            )

            await expectRevert(
                keepFactory.updateOperatorStatus(members[0], application),
                "Operator already up to date"
            )
        })

        it("reverts if the operator is not registered for the application", async () => {
            await initializeNewFactory()
            await initializeMemberCandidates()

            await expectRevert(
                keepFactory.updateOperatorStatus(members[0], application),
                "Operator not registered for the application"
            )
        })
    })

    describe("openKeep", async () => {
        let feeEstimate

        before(async () => {
            await initializeNewFactory()
            await initializeMemberCandidates()
            await registerMemberCandidates()

            feeEstimate = await keepFactory.openKeepFeeEstimate()
        })

        beforeEach(async () => {
            await createSnapshot()
        })

        afterEach(async () => {
            await restoreSnapshot()
        })

        it("reverts if no member candidates are registered", async () => {
            await expectRevert(
                keepFactory.openKeep(
                    groupSize,
                    threshold,
                    keepOwner,
                    bond,
                    { value: feeEstimate }
                ),
                "No signer pool for this application"
            )
        })

        it("reverts if bond equals zero", async () => {
            let bond = 0

            await expectRevert(
                keepFactory.openKeep(
                    groupSize,
                    threshold,
                    keepOwner,
                    bond,
                    { from: application, value: feeEstimate },
                ),
                "Bond per member must be greater than zero"
            )
        })

        it("reverts if value is less than the required fee estimate", async () => {
            const insufficientFee = feeEstimate.sub(new BN(1))

            await expectRevert(
                keepFactory.openKeep(
                    groupSize,
                    threshold,
                    keepOwner,
                    bond,
                    { from: application, fee: insufficientFee },
                ),
                "Insufficient payment for opening a new keep"
            )
        })

        it("opens keep with multiple members", async () => {
            let blockNumber = await web3.eth.getBlockNumber()

            await keepFactory.openKeep(
                groupSize,
                threshold,
                keepOwner,
                bond,
                { from: application, value: feeEstimate },
            )

            let eventList = await keepFactory.getPastEvents('BondedECDSAKeepCreated', {
                fromBlock: blockNumber,
                toBlock: 'latest'
            })

            assert.equal(eventList.length, 1, "incorrect number of emitted events")

            assert.sameMembers(
                eventList[0].returnValues.members,
                [members[0], members[1], members[2]],
                "incorrect keep member in emitted event",
            )
        })

        it("opens bonds for keep", async () => {
            let blockNumber = await web3.eth.getBlockNumber()

            await keepFactory.openKeep(
                groupSize,
                threshold,
                keepOwner,
                bond,
                { from: application, value: feeEstimate },
            )

            let eventList = await keepFactory.getPastEvents('BondedECDSAKeepCreated', {
                fromBlock: blockNumber,
                toBlock: 'latest'
            })

            const keepAddress = eventList[0].returnValues.keepAddress

            expect(
                await keepBonding.bondAmount(members[0], keepAddress, keepAddress)
            ).to.eq.BN(singleBond, 'invalid bond value for members[0]')

            expect(
                await keepBonding.bondAmount(members[1], keepAddress, keepAddress)
            ).to.eq.BN(singleBond, 'invalid bond value for members[1]')

            expect(
                await keepBonding.bondAmount(members[2], keepAddress, keepAddress)
            ).to.eq.BN(singleBond, 'invalid bond value for members[2]')
        })

        it("rounds up members bonds", async () => {
            const requestedBond = bond.add(new BN(1))
            const unbondedAmount = singleBond.add(new BN(1))
            const expectedMemberBond = singleBond.add(new BN(1))

            await depositMemberCandidates(unbondedAmount)

            const blockNumber = await web3.eth.getBlockNumber()
            await keepFactory.openKeep(
                groupSize,
                threshold,
                keepOwner,
                requestedBond,
                { from: application, value: feeEstimate },
            )

            let eventList = await keepFactory.getPastEvents('BondedECDSAKeepCreated', {
                fromBlock: blockNumber,
                toBlock: 'latest'
            })

            const keepAddress = eventList[0].returnValues.keepAddress

            expect(
                await keepBonding.bondAmount(members[0], keepAddress, keepAddress),
                'invalid bond value for members[0]'
            ).to.eq.BN(expectedMemberBond)

            expect(
                await keepBonding.bondAmount(members[1], keepAddress, keepAddress),
                'invalid bond value for members[1]'
            ).to.eq.BN(expectedMemberBond)

            expect(
                await keepBonding.bondAmount(members[2], keepAddress, keepAddress),
                'invalid bond value for members[2]'
            ).to.eq.BN(expectedMemberBond)
        })

        it("rounds up members bonds when calculated bond per member equals zero", async () => {
            const requestedBond = new BN(groupSize).sub(new BN(1))
            const unbondedAmount = new BN(1)
            const expectedMemberBond = new BN(1)

            await depositMemberCandidates(unbondedAmount)

            const blockNumber = await web3.eth.getBlockNumber()
            await keepFactory.openKeep(
                groupSize,
                threshold,
                keepOwner,
                requestedBond,
                { from: application, value: feeEstimate },
            )

            let eventList = await keepFactory.getPastEvents('BondedECDSAKeepCreated', {
                fromBlock: blockNumber,
                toBlock: 'latest'
            })

            const keepAddress = eventList[0].returnValues.keepAddress

            expect(
                await keepBonding.bondAmount(members[0], keepAddress, keepAddress),
                'invalid bond value for members[0]'
            ).to.eq.BN(expectedMemberBond)

            expect(
                await keepBonding.bondAmount(members[1], keepAddress, keepAddress),
                'invalid bond value for members[1]'
            ).to.eq.BN(expectedMemberBond)

            expect(
                await keepBonding.bondAmount(members[2], keepAddress, keepAddress),
                'invalid bond value for members[2]'
            ).to.eq.BN(expectedMemberBond)
        })

        it("reverts if not enough member candidates are registered", async () => {
            let requestedGroupSize = groupSize.addn(1)

            await expectRevert(
                keepFactory.openKeep(
                    requestedGroupSize,
                    threshold,
                    keepOwner,
                    bond,
                    { from: application, value: feeEstimate }
                ),
                "Not enough operators in pool"
            )
        })

        it("reverts if one member has insufficient unbonded value", async () => {
            const minimumBond = await keepFactory.minimumBond.call()
            const availableUnbonded = await keepBonding.availableUnbondedValue(members[2], keepFactory.address, signerPool)
            const withdrawValue = availableUnbonded.sub(minimumBond).add(new BN(1))
            await keepBonding.withdraw(withdrawValue, members[2], { from: members[2] })

            await expectRevert(
                keepFactory.openKeep(
                    groupSize,
                    threshold,
                    keepOwner,
                    bond,
                    { from: application, value: feeEstimate }
                ),
                "Not enough operators in pool"
            )
        })

        it("opens keep with multiple members and emits an event", async () => {
            let blockNumber = await web3.eth.getBlockNumber()

            const keep = await openKeep()

            let eventList = await keepFactory.getPastEvents('BondedECDSAKeepCreated', {
                fromBlock: blockNumber,
                toBlock: 'latest'
            })

            assert.isTrue(
                web3.utils.isAddress(keep.address),
                `keep address ${keep.address} is not a valid address`,
            );

            assert.equal(eventList.length, 1, "incorrect number of emitted events")

            assert.equal(
                eventList[0].returnValues.keepAddress,
                keep.address,
                "incorrect keep address in emitted event",
            )

            assert.sameMembers(
                eventList[0].returnValues.members,
                [members[0], members[1], members[2]],
                "incorrect keep member in emitted event",
            )

            assert.equal(
                eventList[0].returnValues.owner,
                keepOwner,
                "incorrect keep owner in emitted event",
            )
        })

        it("requests new random group selection seed from random beacon", async () => {
            const expectedNewEntry = new BN(789)

            await randomBeacon.setEntry(expectedNewEntry)

            await keepFactory.openKeep(
                groupSize,
                threshold,
                keepOwner,
                bond,
                { from: application, value: feeEstimate }
            )

            assert.equal(
                await randomBeacon.requestCount.call(),
                1,
                "incorrect number of beacon calls",
            )

            expect(
                await keepFactory.getGroupSelectionSeed()
            ).to.eq.BN(expectedNewEntry, "incorrect new group selection seed")
        })

        it("calculates new group selection seed", async () => {
            // Set entry to `0` so the beacon stub won't execute the callback.
            await randomBeacon.setEntry(0)

            const groupSelectionSeed = new BN(12)
            await keepFactory.initialGroupSelectionSeed(groupSelectionSeed)

            const expectedNewGroupSelectionSeed = web3.utils.toBN(
                web3.utils.soliditySha3(groupSelectionSeed, keepFactory.address)
            )

            await keepFactory.openKeep(
                groupSize,
                threshold,
                keepOwner,
                bond,
                { from: application, value: feeEstimate }
            )

            expect(
                await keepFactory.getGroupSelectionSeed()
            ).to.eq.BN(
                expectedNewGroupSelectionSeed,
                "incorrect new group selection seed"
            )
        })

        it("ignores beacon request relay entry failure", async () => {
            await randomBeacon.setShouldFail(true)

            await keepFactory.openKeep(
                groupSize,
                threshold,
                keepOwner,
                bond,
                { from: application, value: feeEstimate }
            )

            // TODO: Add verification of what we will do in case of the failure.
        })

        it("forwards payment to random beacon", async () => {
            const value = new BN(150)

            await keepFactory.openKeep(
                groupSize,
                threshold,
                keepOwner,
                bond,
                { from: application, value: value }
            )

            expect(
                await web3.eth.getBalance(randomBeacon.address)
            ).to.eq.BN(
                value,
                "incorrect random beacon balance"
            )
        })

        it("reverts when honest threshold is greater than the group size", async () => {
            let honestThreshold = 4
            let groupSize = 3

            await expectRevert(
                keepFactory.openKeep(
                    groupSize,
                    honestThreshold,
                    keepOwner,
                    bond,
                    { from: application, value: feeEstimate },
                ),
                "Honest threshold must be less or equal the group size"
            )
        })

        it("works when honest threshold is equal to the group size", async () => {
            let honestThreshold = 3
            let groupSize = honestThreshold

            let blockNumber = await web3.eth.getBlockNumber()

            await keepFactory.openKeep(
                groupSize,
                honestThreshold,
                keepOwner,
                bond,
                { from: application, value: feeEstimate },
            )

            let eventList = await keepFactory.getPastEvents('BondedECDSAKeepCreated', {
                fromBlock: blockNumber,
                toBlock: 'latest'
            })

            assert.equal(eventList.length, 1, "incorrect number of emitted events")
        })

        it("allows to use a group of 16 signers", async () => {
            let groupSize = 16

            // create and authorize enough operators to perform the test;
            // we need more than the default 10 accounts
            await createDepositAndRegisterMembers(groupSize, singleBond)

            let blockNumber = await web3.eth.getBlockNumber()

            await keepFactory.openKeep(
                groupSize,
                threshold,
                keepOwner,
                bond,
                { from: application, value: feeEstimate },
            )

            let eventList = await keepFactory.getPastEvents('BondedECDSAKeepCreated', {
                fromBlock: blockNumber,
                toBlock: 'latest'
            })

            assert.equal(eventList.length, 1, "incorrect number of emitted events")
            assert.equal(
                eventList[0].returnValues.members.length,
                groupSize,
                "incorrect number of members"
            )
        })

        it("reverts when trying to use a group of 17 signers", async () => {
            let groupSize = 17

            await expectRevert(
                keepFactory.openKeep(
                    groupSize,
                    threshold,
                    keepOwner,
                    bond,
                    { from: application, value: feeEstimate },
                ),
                "Maximum signing group size is 16"
            )
        })

        it("records the keep address and opening time", async () => {
            let preKeepCount = await keepFactory.getKeepCount()

            let keepAddress = await keepFactory.openKeep.call(
                groupSize,
                threshold,
                keepOwner,
                bond,
                { from: application, value: feeEstimate }
            )

            await keepFactory.openKeep(
                groupSize,
                threshold,
                keepOwner,
                bond,
                { from: application, value: feeEstimate }
            )
            let recordedKeepAddress = await keepFactory.getKeepAtIndex(preKeepCount)
            let keep = await BondedECDSAKeep.at(keepAddress)
            let keepCreationTime = await keep.getTimestamp()
            let factoryCreationTime = await keepFactory.getCreationTime(keepAddress)

            assert.equal(
                recordedKeepAddress,
                keepAddress,
                "address recorded in factory differs from returned keep address",
            );

            expect(
                factoryCreationTime
            ).to.eq.BN(
                keepCreationTime,
                "creation time in factory differs from creation time in keep",
            )
        })

        async function createDepositAndRegisterMembers(memberCount, unbondedAmount) {
            const stakeBalance = await keepFactory.minimumStake.call()

            for (let i = 0; i < memberCount; i++) {
                const operator = await web3.eth.personal.newAccount("pass")
                await web3.eth.personal.unlockAccount(operator, "pass", 5000) // 5 sec unlock

                web3.eth.sendTransaction({
                    from: accounts[0],
                    to: operator,
                    value: web3.utils.toWei('1', 'ether')
                });

                await tokenStaking.setBalance(operator, stakeBalance)
                await tokenStaking.authorizeOperatorContract(operator, keepFactory.address)
                await keepBonding.authorizeSortitionPoolContract(operator, signerPool, { from: operator })
                await keepBonding.deposit(operator, { value: unbondedAmount })
                await keepFactory.registerMemberCandidate(application, { from: operator })
            }
        }
    })

    describe("setGroupSelectionSeed", async () => {
        const newGroupSelectionSeed = new BN(2345675)

        before(async () => {
            registry = await Registry.new()
            bondedSortitionPoolFactory = await BondedSortitionPoolFactory.new()
            tokenStaking = await TokenStakingStub.new()
            keepBonding = await KeepBonding.new(registry.address, tokenStaking.address)
            randomBeacon = accounts[1]
            const bondedECDSAKeepMasterContract = await BondedECDSAKeep.new()
            keepFactory = await BondedECDSAKeepFactoryStub.new(
                bondedECDSAKeepMasterContract.address,
                bondedSortitionPoolFactory.address,
                tokenStaking.address,
                keepBonding.address,
                randomBeacon
            )
        })

        beforeEach(async () => {
            await createSnapshot()
        })

        afterEach(async () => {
            await restoreSnapshot()
        })

        it("sets group selection seed", async () => {
            await keepFactory.setGroupSelectionSeed(newGroupSelectionSeed, { from: randomBeacon })

            expect(
                await keepFactory.getGroupSelectionSeed()
            ).to.eq.BN(
                newGroupSelectionSeed,
                "incorrect new group selection seed"
            )
        })

        it("reverts if called not by the random beacon", async () => {
            await expectRevert(
                keepFactory.setGroupSelectionSeed(newGroupSelectionSeed, { from: accounts[2] }),
                "Caller is not the random beacon"
            )
        })
    })

    describe("slashKeepMembers", async () => {
        const keepOwner = "0xbc4862697a1099074168d54A555c4A60169c18BD"
        let keep

        before(async () => {
            await initializeNewFactory()

            keep = await BondedECDSAKeepStub.new()
            await keep.initialize(
                keepOwner,
                members,
                members.length,
                tokenStaking.address,
                keepBonding.address,
                keepFactory.address
            )
        })

        beforeEach(async () => {
            await createSnapshot()
        })

        afterEach(async () => {
            await restoreSnapshot()
        })

        it("reverts if called not by keep", async () => {
            await expectRevert(
                keepFactory.slashKeepMembers(),
                "Caller is not an active keep created by this factory"
            )
        })

        it("reverts if called by not authorized keep", async () => {
            // The keep is not added to the list of keeps created by the factory.
            await expectRevert(
                keep.exposedSlashSignerStakes(),
                "Caller is not an active keep created by this factory"
            )
        })

        it("slashes keep members stakes", async () => {
            // Add keep to the list of keeps created by the factory.
            await keepFactory.addKeep(keep.address)

            const minimumStake = await keepFactory.minimumStake.call()
            const remainingStake = new BN(10)
            const stakeBalance = minimumStake.add(remainingStake)
            await stakeOperators(members, stakeBalance)

            await keep.exposedSlashSignerStakes()

            for (let i = 0; i < members.length; i++) {
                const actualStake = await tokenStaking.eligibleStake(members[i], keepFactory.address)
                expect(actualStake).to.eq.BN(remainingStake, `incorrect stake for member ${i}`)
            }
        })
    })

    describe("newGroupSelectionSeedFee", async () => {
        let newEntryFee;

        before(async () => {
            await initializeNewFactory()

            let callbackGas = await keepFactory.callbackGas()
            newEntryFee = await randomBeacon.entryFeeEstimate(callbackGas)
        })


        beforeEach(async () => {
            await createSnapshot()
        })

        afterEach(async () => {
            await restoreSnapshot()
        })

        it("evaluates reseed fee for empty pool", async () => {
            let reseedFee = await keepFactory.newGroupSelectionSeedFee()
            expect(reseedFee).to.eq.BN(
                newEntryFee, 
                "reseed fee should equal new entry fee"
            )
        })

        it("evaluates reseed fee for non-empty pool", async () => {
            let poolValue = new BN(15)
            web3.eth.sendTransaction({
                from: accounts[0],
                to: keepFactory.address,
                value: poolValue
            });

            let reseedFee = await keepFactory.newGroupSelectionSeedFee()
            expect(reseedFee).to.eq.BN(
                newEntryFee.sub(poolValue), 
                "reseed fee should equal new entry fee minus pool value"
            )
        })

        it("should reseed for free if has enough funds in the pool", async () => {
            web3.eth.sendTransaction({
                from: accounts[0],
                to: keepFactory.address,
                value: newEntryFee
            });

            let reseedFee = await keepFactory.newGroupSelectionSeedFee()
            expect(reseedFee).to.eq.BN(0, "reseed fee should be zero")
        })

        it("should reseed for free if has more than needed funds in the pool", async () => {
            web3.eth.sendTransaction({
                from: accounts[0],
                to: keepFactory.address,
                value: newEntryFee.addn(1)
            });

            let reseedFee = await keepFactory.newGroupSelectionSeedFee()
            expect(reseedFee).to.eq.BN(0, "reseed fee should be zero")
        })
    })

    describe("requestNewGroupSelectionSeed", async () => {
        let newEntryFee

        before(async () => {
            await initializeNewFactory()
            let callbackGas = await keepFactory.callbackGas()
            newEntryFee = await randomBeacon.entryFeeEstimate(callbackGas)
        })

        beforeEach(async () => {
            await createSnapshot()
        })

        afterEach(async () => {
            await restoreSnapshot()
        })

        it("requests new relay entry from the beacon and reseeds factory", async () => {
            const expectedNewEntry = new BN(1337)
            await randomBeacon.setEntry(expectedNewEntry)

            let reseedFee = await keepFactory.newGroupSelectionSeedFee()
            await keepFactory.requestNewGroupSelectionSeed({ value: reseedFee })

            assert.equal(
                await randomBeacon.requestCount.call(),
                1,
                "incorrect number of beacon calls",
            )

            expect(
                await keepFactory.getGroupSelectionSeed()
            ).to.eq.BN(expectedNewEntry, "incorrect new group selection seed")
        })

        it("allows to reseed for free if the pool is full", async () => {
            const expectedNewEntry = new BN(997)
            await randomBeacon.setEntry(expectedNewEntry)

            let poolValue = newEntryFee
            web3.eth.sendTransaction({
                from: accounts[0],
                to: keepFactory.address,
                value: poolValue
            });

            await keepFactory.requestNewGroupSelectionSeed({ value: 0 })

            assert.equal(
                await randomBeacon.requestCount.call(),
                1,
                "incorrect number of beacon calls",
            )

            expect(
                await keepFactory.getGroupSelectionSeed()
            ).to.eq.BN(expectedNewEntry, "incorrect new group selection seed")
        })

        it("updates pool after reseeding", async () => {
            await randomBeacon.setEntry(new BN(1337))

            let poolValue = newEntryFee.muln(15)
            web3.eth.sendTransaction({
                from: accounts[0],
                to: keepFactory.address,
                value: poolValue
            });

            await keepFactory.requestNewGroupSelectionSeed({ value: 0 })

            let expectedPoolValue = poolValue.sub(newEntryFee)
            expect(
                await keepFactory.reseedPool()
            ).to.eq.BN(expectedPoolValue, "unexpected reseed pool value")
        })

        it("updates pool after reseeding with value", async () => {
            await randomBeacon.setEntry(new BN(1337))

            let poolValue = newEntryFee.muln(15)
            web3.eth.sendTransaction({
                from: accounts[0],
                to: keepFactory.address,
                value: poolValue
            });

            const valueSent = new BN(10)
            await keepFactory.requestNewGroupSelectionSeed({ value: 10 })

            let expectedPoolValue = poolValue.sub(newEntryFee).add(valueSent)
            expect(
                await keepFactory.reseedPool()
            ).to.eq.BN(expectedPoolValue, "unexpected reseed pool value")
        })

        it("reverts if the provided payment is not sufficient", async () => {
            let poolValue = newEntryFee.subn(2)
            web3.eth.sendTransaction({
                from: accounts[0],
                to: keepFactory.address,
                value: poolValue
            });

            await expectRevert(
                keepFactory.requestNewGroupSelectionSeed({ value: 1}),
                "Not enough funds to trigger reseed"
            )
        })

        it("reverts if beacon is busy", async () => {
            await randomBeacon.setShouldFail(true)

            let reseedFee = await keepFactory.newGroupSelectionSeedFee()
            await expectRevert(
                keepFactory.requestNewGroupSelectionSeed({ value: reseedFee }),
                "request relay entry failed"
            )
        })
    })

    async function initializeNewFactory() {
        registry = await Registry.new()
        bondedSortitionPoolFactory = await BondedSortitionPoolFactory.new()
        tokenStaking = await TokenStakingStub.new()
        keepBonding = await KeepBonding.new(registry.address, tokenStaking.address)
        randomBeacon = await RandomBeaconStub.new()
        const bondedECDSAKeepMasterContract = await BondedECDSAKeep.new()
        keepFactory = await BondedECDSAKeepFactoryStub.new(
            bondedECDSAKeepMasterContract.address,
            bondedSortitionPoolFactory.address,
            tokenStaking.address,
            keepBonding.address,
            randomBeacon.address
        )

        await registry.approveOperatorContract(keepFactory.address)

        minimumStake = await keepFactory.minimumStake.call()

        await stakeOperators(members, minimumStake)
    }

    async function stakeOperators(members, stakeBalance) {
        for (let i = 0; i < members.length; i++) {
            await tokenStaking.setBalance(members[i], stakeBalance)
        }
    }

    async function initializeMemberCandidates(unbondedValue) {
        const minimumBond = await keepFactory.minimumBond.call()

        signerPool = await keepFactory.createSortitionPool.call(application)
        await keepFactory.createSortitionPool(application)

        for (let i = 0; i < members.length; i++) {
            await tokenStaking.authorizeOperatorContract(members[i], keepFactory.address)
            await keepBonding.authorizeSortitionPoolContract(members[i], signerPool, { from: authorizers[i] })
        }

        const unbondedAmount = unbondedValue || minimumBond

        await depositMemberCandidates(unbondedAmount)
    }

    async function depositMemberCandidates(unbondedAmount) {
        for (let i = 0; i < members.length; i++) {
            await keepBonding.deposit(members[i], { value: unbondedAmount })
        }
    }

    async function registerMemberCandidates() {
        for (let i = 0; i < members.length; i++) {
            await keepFactory.registerMemberCandidate(application, { from: members[i] })
        }

        const pool = await BondedSortitionPool.at(signerPool)
        const initBlocks = await pool.operatorInitBlocks()
        await mineBlocks(initBlocks.add(new BN(1)))
    }

    async function openKeep() {
        const feeEstimate = await keepFactory.openKeepFeeEstimate()

        const keepAddress = await keepFactory.openKeep.call(
            groupSize,
            threshold,
            keepOwner,
            bond,
            { from: application, value: feeEstimate },
        )

        await keepFactory.openKeep(
            groupSize,
            threshold,
            keepOwner,
            bond,
            { from: application, value: feeEstimate },
        )

        return await BondedECDSAKeep.at(keepAddress)
    }
})
