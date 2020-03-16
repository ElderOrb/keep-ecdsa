import { createSnapshot, restoreSnapshot } from "./helpers/snapshot";
import { increaseTime } from './helpers/increaseTime';
const { expectRevert } = require('openzeppelin-test-helpers');

const Registry = artifacts.require('Registry');
const RewardsFactoryStub = artifacts.require('RewardsFactoryStub');
const KeepBonding = artifacts.require('KeepBonding');
const TokenStakingStub = artifacts.require("TokenStakingStub")
const BondedSortitionPoolFactory = artifacts.require('BondedSortitionPoolFactory');
const RandomBeaconStub = artifacts.require('RandomBeaconStub')
const TestToken = artifacts.require('TestToken')


const RewardsKeepStub = artifacts.require('RewardsKeepStub');
const ECDSAKeepRewardsStub = artifacts.require('ECDSAKeepRewardsStub');

contract.only('ECDSAKeepRewards', (accounts) => {
    const alice = accounts[0]
    const bob = accounts[1]
    const aliceBeneficiary = accounts[2]
    const bobBeneficiary = accounts[3]
    const funder = accounts[9]

    let factory
    let registry
    let rewards
    let token

    let tokenStaking
    let keepFactory
    let bondedSortitionPoolFactory
    let keepBonding
    let randomBeacon
    let signerPool

    // defaultTimestamps[i] == 1000 + i
    const defaultTimestamps = [
        1000,
        1001,
        1002,
        1003,
        1004,
        1005,
        1006,
        1007,
        1008,
        1009,
        1010,
        1011,
        1012,
        1013,
        1014,
        1015,
    ]

    const initiationTime = 1000
    const termLength = 100
    const totalRewards = 1000000
    const minimumIntervalKeeps = 2

    const rewardTimestamps = [
        1000, 1001, 1099, // interval 0; 0..2
        1100, 1101, 1102, 1103, // interval 1; 3..6
        1234, // interval 2; 7
        1300, 1301, // interval 3; 8..9
        1500, // interval 5; 10
        1600, 1601, // interval 6; 11..12
    ]
    const keepsInRewardIntervals = [
        3, 4, 1, 2, 0, 1, 2, 0,
    ]
    const rewardIntervalAdjustments = [
        100, 100, 50, 100, 0, 50, 100, 0,
    ]

    const intervalWeights = [
        // percentage of unallocated rewards, allocated : remaining
        20, // 20:80
        50, // 40:40
        25, // 10:30
        50, // 15:15
    ]
    const inVacuumBaseRewards = [
        200000,
        500000,
        250000,
        500000,
        1000000,
        1000000,
        1000000,
    ]
    const inVacuumAdjustedRewards = [
        200000,
        500000,
        125000,
        500000,
        0,
        500000,
        1000000,
    ]
    const inVacuumPerKeepRewards = [
        66666,
        125000,
        125000,
        250000,
        0,
        500000,
        500000,
    ]
    const actualAllocations = [
        199998, // 800002 remaining
        400000, // 400002 remaining
        50000,  // 350002 remaining
        175000, // 175002 remaining
        0,
        87501, // 87501 remaining
        87500, // 1 remaining
    ]

    async function initializeNewFactory() {
        registry = await Registry.new()
        bondedSortitionPoolFactory = await BondedSortitionPoolFactory.new()
        tokenStaking = await TokenStakingStub.new()
        keepBonding = await KeepBonding.new(registry.address, tokenStaking.address)
        randomBeacon = await RandomBeaconStub.new()
        const bondedECDSAKeepMasterContract = await RewardsKeepStub.new()
        keepFactory = await RewardsFactoryStub.new(
            bondedECDSAKeepMasterContract.address,
            bondedSortitionPoolFactory.address,
            tokenStaking.address,
            keepBonding.address,
            randomBeacon.address
        )

        await tokenStaking.setMagpie(alice, aliceBeneficiary)
        await tokenStaking.setMagpie(bob, bobBeneficiary)
    }

    async function createKeeps(timestamps) {
        await keepFactory.openSyntheticKeeps([alice, bob], timestamps)
        for (let i = 0; i < timestamps.length; i++) {
            let keepAddress = await keepFactory.getKeepAtIndex(i)
            let keep = await RewardsKeepStub.at(keepAddress)
            await keep.setTimestamp(timestamps[i])
        }
    }

    async function fund(amount) {
        await token.mint(funder, amount)
        await token.approveAndCall(
            rewards.address,
            amount,
            "0x0",
            { from: funder }
        )
    }

    before(async () => {
        await initializeNewFactory()

        token = await TestToken.new()

        rewards = await ECDSAKeepRewardsStub.new(
            termLength,
            token.address,
            minimumIntervalKeeps,
            keepFactory.address,
            initiationTime,
            intervalWeights
        )

        await fund(totalRewards)
    })

    beforeEach(async () => {
        await createSnapshot()
    })

    afterEach(async () => {
        await restoreSnapshot()
    })

    describe("receiveApproval", async () => {
        it("funds the rewards correctly", async () => {
            let preRewards = await rewards.getTotalRewards()
            expect(preRewards.toNumber()).to.equal(totalRewards)

            await fund(totalRewards)
            let postRewards = await rewards.getTotalRewards()
            expect(postRewards.toNumber()).to.equal(totalRewards * 2)
        })

        it("collects tokens sent outside `approveAndCall`", async () => {
            await token.mint(funder, totalRewards)
            await token.transfer(rewards.address, totalRewards, {from: funder})

            let preRewards = await rewards.getTotalRewards()
            expect(preRewards.toNumber()).to.equal(totalRewards)

            await fund(0)
            let postRewards = await rewards.getTotalRewards()
            expect(postRewards.toNumber()).to.equal(totalRewards * 2)
        })
    })

    describe("eligibleForReward", async () => {
        it("returns true for happily closed keeps", async () => {
            await createKeeps([1000])
            let keepAddress = await keepFactory.getKeepAtIndex(0)
            let keep = await RewardsKeepStub.at(keepAddress)
            await keep.close()
            let eligible = await rewards.eligibleForReward(keepAddress)
            expect(eligible).to.equal(true)
        })

        it("returns false for terminated keeps", async () => {
            await createKeeps([1000])
            let keepAddress = await keepFactory.getKeepAtIndex(0)
            let keep = await RewardsKeepStub.at(keepAddress)
            await keep.terminate()
            let eligible = await rewards.eligibleForReward(keepAddress)
            expect(eligible).to.equal(false)
        })

        it("returns false for active keeps", async () => {
            await createKeeps([1000])
            let keepAddress = await keepFactory.getKeepAtIndex(0)
            let eligible = await rewards.eligibleForReward(keepAddress)
            expect(eligible).to.equal(false)
        })
    })

    describe("intervalOf", async () => {
        it("returns the correct interval", async () => {
            let interval999 = await rewards.intervalOf(999)
            expect(interval999.toNumber()).to.equal(0)
            let interval1000 = await rewards.intervalOf(1000)
            expect(interval1000.toNumber()).to.equal(0)
            let interval1001 = await rewards.intervalOf(1001)
            expect(interval1001.toNumber()).to.equal(0)
            let interval1099 = await rewards.intervalOf(1099)
            expect(interval1099.toNumber()).to.equal(0)
            let interval1100 = await rewards.intervalOf(1100)
            expect(interval1100.toNumber()).to.equal(1)
            let interval1101 = await rewards.intervalOf(1101)
            expect(interval1101.toNumber()).to.equal(1)
            let interval1000000 = await rewards.intervalOf(1000000)
            expect(interval1000000.toNumber()).to.equal(9990)
        })
    })

    describe("startOf", async () => {
        it("returns the start of the interval", async () => {
            let end0 = await rewards.startOf(0)
            expect(end0.toNumber()).to.equal(1000)
            let end1 = await rewards.startOf(1)
            expect(end1.toNumber()).to.equal(1100)
            let end9990 = await rewards.startOf(9990)
            expect(end9990.toNumber()).to.equal(1000000)
        })
    })

    describe("endOf", async () => {
        it("returns the end of the interval", async () => {
            let end0 = await rewards.endOf(0)
            expect(end0.toNumber()).to.equal(1100)
            let end1 = await rewards.endOf(1)
            expect(end1.toNumber()).to.equal(1200)
            let end9990 = await rewards.endOf(9990)
            expect(end9990.toNumber()).to.equal(1000100)
        })
    })

    describe("findEndpoint", async () => {
        let increment = 1000

        it("returns 0 when no keeps have been created", async () => {
            let targetTimestamp = await rewards.currentTime()
            increaseTime(increment)

            let index = await rewards.findEndpoint(targetTimestamp)
            expect(index.toNumber()).to.equal(0)
        })

        it("returns 0 when all current keeps were created after the interval", async () => {
            let timestamps = defaultTimestamps
            await createKeeps(timestamps)
            let targetTimestamp = 500
            let expectedIndex = 0
            let index = await rewards.findEndpoint(targetTimestamp)

            expect(index.toNumber()).to.equal(expectedIndex)
        })

        it("returns the first index outside the interval", async () => {
            let timestamps = defaultTimestamps
            await createKeeps(timestamps)
            for (let i = 0; i < timestamps.length; i++) {
                let expectedIndex = i
                let targetTimestamp = timestamps[i]
                let index = await rewards.findEndpoint(targetTimestamp)

                expect(index.toNumber()).to.equal(expectedIndex)
            }
        })

        it("returns the number of keeps when all current keeps were created in the interval", async () => {
            let timestamps = defaultTimestamps
            await createKeeps(timestamps)
            let targetTimestamp = 2000
            let expectedIndex = 16
            let index = await rewards.findEndpoint(targetTimestamp)

            expect(index.toNumber()).to.equal(expectedIndex)
        })

        it("returns the correct index when duplicates are present", async () => {
            let timestamps = [1001, 1001, 1002, 1002]
            await createKeeps(timestamps)
            let targetTimestamp = 1002
            let expectedIndex = 2
            let index = await rewards.findEndpoint(targetTimestamp)

            expect(index.toNumber()).to.equal(expectedIndex)
        })

        it("reverts if the endpoint is in the future", async () => {
            let recentTimestamp = await rewards.currentTime()
            let targetTimestamp = recentTimestamp + increment
            await expectRevert(
                rewards.findEndpoint(targetTimestamp),
                "interval hasn't ended yet"
            )
        })
    })

    describe("getEndpoint", async () => {
        it("returns the correct number of keeps for the interval", async () => {
            let timestamps = defaultTimestamps
            await createKeeps(timestamps)
            let keepCount = await rewards.getEndpoint.call(0)
            expect(keepCount.toNumber()).to.equal(timestamps.length)
        })

        it("returns 0 for intervals with no keeps", async () => {
            let timestamps = [1200, 1201]
            await createKeeps(timestamps)
            let keepCount = await rewards.getEndpoint.call(1)
            expect(keepCount.toNumber()).to.equal(0)
        })

        it("reverts if the interval hasn't ended", async () => {
            let recentTimestamp = await rewards.currentTime()
            let targetTimestamp = recentTimestamp + termLength
            let targetInterval = await rewards.intervalOf(targetTimestamp)
            await expectRevert(
                rewards.getEndpoint(targetInterval),
                "Interval hasn't ended yet"
            )
        })
    })

    describe("keepsInInterval", async () => {
        it("returns the correct number of keeps for the interval", async () => {
            let timestamps = rewardTimestamps
            let expectedCounts = keepsInRewardIntervals
            await createKeeps(timestamps)
            for (let i = 0; i < expectedCounts.length; i++) {
                let keepCount = await rewards.keepsInInterval.call(i)
                expect(keepCount.toNumber()).to.equal(expectedCounts[i])
            }
        })
    })

    describe("keepCountAdjustment", async () => {
        it("returns the adjustment percentage of the interval", async () => {
            let timestamps = rewardTimestamps
            let expectedPercentages = rewardIntervalAdjustments
            await createKeeps(timestamps)
            for (let i = 0; i < expectedPercentages.length; i++) {
                let keepCount = await rewards.keepCountAdjustment.call(i)
                expect(keepCount.toNumber()).to.equal(expectedPercentages[i])
            }
        })
    })

    describe("getIntervalWeight", async () => {
        it("returns the weight of a defined interval", async () => {
            let weight0 = await rewards.getIntervalWeight(0)
            expect(weight0.toNumber()).to.equal(20)
            let weight3 = await rewards.getIntervalWeight(3)
            expect(weight3.toNumber()).to.equal(50)
        })

        it("returns 100% after the defined intervals", async () => {
            let weight4 = await rewards.getIntervalWeight(4)
            expect(weight4.toNumber()).to.equal(100)
        })
    })

    describe("getIntervalCount", async () => {
        it("returns the number of defined intervals", async () => {
            let intervalCount = await rewards.getIntervalCount()
            expect(intervalCount.toNumber()).to.equal(4)
        })
    })

    describe("baseAllocation", async () => {
        it("returns the maximum reward of a defined interval", async () => {
            let expectedAllocations = inVacuumBaseRewards
            for (let i = 0; i < expectedAllocations.length; i++) {
                let allocation = await rewards.baseAllocation(i)
                expect(allocation.toNumber()).to.equal(expectedAllocations[i])
            }
        })
    })

    describe("adjustedAllocation", async () => {
        it("returns the adjusted reward allocation of the interval", async () => {
            let timestamps = rewardTimestamps
            let expectedAllocations = inVacuumAdjustedRewards
            await createKeeps(timestamps)
            for (let i = 0; i < expectedAllocations.length; i++) {
                let allocation = await rewards.adjustedAllocation.call(i)
                expect(allocation.toNumber()).to.equal(expectedAllocations[i])
            }
        })
    })

    describe("rewardPerKeep", async () => {
        it("returns the per keep allocation of the interval", async () => {
            let timestamps = rewardTimestamps
            let expectedAllocations = inVacuumPerKeepRewards
            await createKeeps(timestamps)
            for (let i = 0; i < expectedAllocations.length; i++) {
                let allocation = await rewards.rewardPerKeep.call(i)
                expect(allocation.toNumber()).to.equal(expectedAllocations[i])
            }
        })
    })

    describe("allocateRewards", async () => {
        it("allocates the reward for each interval", async () => {
            let timestamps = rewardTimestamps
            let expectedAllocations = actualAllocations
            await createKeeps(timestamps)
            for (let i = 0; i < expectedAllocations.length; i++) {
                await rewards.allocateRewards(i)
                let allocation = await rewards.getAllocatedRewards(i)
                expect(allocation.toNumber()).to.equal(expectedAllocations[i])
            }
        })

        it("allocates the rewards recursively", async () => {
            let timestamps = rewardTimestamps
            let expectedAllocations = actualAllocations
            await createKeeps(timestamps)
            await rewards.allocateRewards(expectedAllocations.length - 1)
            for (let i = 0; i < expectedAllocations.length; i++) {
                let allocation = await rewards.getAllocatedRewards(i)
                expect(allocation.toNumber()).to.equal(expectedAllocations[i])
            }
        })
    })

    describe("isAllocated", async () => {
        it("returns false before allocation and true after allocation", async () => {
            let timestamps = rewardTimestamps
            let expectedAllocations = actualAllocations
            await createKeeps(timestamps)
            for (let i = 0; i < expectedAllocations.length; i++) {
                let preAllocated = await rewards.isAllocated(i)
                expect(preAllocated).to.equal(false)
                await rewards.allocateRewards(i)
                let postAllocated = await rewards.isAllocated(i)
                expect(postAllocated).to.equal(true)
            }
        })
    })

    describe("receiveReward", async () => {
        it("lets closed keeps claim the reward correctly", async () => {
            let timestamps = rewardTimestamps
            await createKeeps(timestamps)
            let keepAddress = await keepFactory.getKeepAtIndex(0)
            let keep = await RewardsKeepStub.at(keepAddress)
            await keep.close()
            await rewards.receiveReward(keepAddress)
            let aliceBalance = await token.balanceOf(aliceBeneficiary)
            expect(aliceBalance.toNumber()).to.equal(33333)
        })

        it("doesn't let keeps claim rewards again", async () => {
            let timestamps = rewardTimestamps
            await createKeeps(timestamps)
            let keepAddress = await keepFactory.getKeepAtIndex(0)
            let keep = await RewardsKeepStub.at(keepAddress)
            await keep.close()
            await rewards.receiveReward(keepAddress)
            await expectRevert(
                rewards.receiveReward(keepAddress),
                "Rewards already claimed"
            )
        })

        it("doesn't let active keeps claim the reward", async () => {
            await createKeeps(rewardTimestamps)
            let keepAddress = await keepFactory.getKeepAtIndex(0)
            await expectRevert(
                rewards.receiveReward(keepAddress),
                "Keep is not closed"
            )
        })

        it("doesn't let terminated keeps claim the reward", async () => {
            await createKeeps(rewardTimestamps)
            let keepAddress = await keepFactory.getKeepAtIndex(0)
            let keep = await RewardsKeepStub.at(keepAddress)
            await keep.terminate()
            await expectRevert(
                rewards.receiveReward(keepAddress),
                "Keep is not closed"
            )
        })

        it("doesn't let unrecognized keeps claim the reward", async () => {
            await createKeeps(rewardTimestamps)
            let fakeKeepAddress = accounts[8]
            await expectRevert(
                rewards.receiveReward(fakeKeepAddress),
                "Keep address not recognized by factory"
            )
        })
    })

    describe("reportTermination", async () => {
        it("unallocates rewards allocated to terminated keeps", async () => {
            let timestamps = rewardTimestamps
            await createKeeps(timestamps)

            let closedKeepAddress = await keepFactory.getKeepAtIndex(1)
            let closedKeep = await RewardsKeepStub.at(closedKeepAddress)
            await closedKeep.close()
            await rewards.receiveReward(closedKeepAddress) // allocate rewards

            let terminatedKeepAddress = await keepFactory.getKeepAtIndex(0)
            let terminatedKeep = await RewardsKeepStub.at(terminatedKeepAddress)
            await terminatedKeep.terminate()
            let preUnallocated = await rewards.getUnallocatedRewards()
            await rewards.reportTermination(terminatedKeepAddress)
            let postUnallocated = await rewards.getUnallocatedRewards()
            expect(postUnallocated.toNumber()).to.equal(
                preUnallocated.toNumber() + 66666
            )
        })

        it("doesn't unallocate rewards twice for the same keep", async () => {
            let timestamps = rewardTimestamps
            await createKeeps(timestamps)
            let keepAddress = await keepFactory.getKeepAtIndex(0)
            let keep = await RewardsKeepStub.at(keepAddress)
            await keep.terminate()
            await rewards.reportTermination(keepAddress)
            await expectRevert(
                rewards.reportTermination(keepAddress),
                "Rewards already claimed"
            )
        })

        it("doesn't unallocate active keeps' rewards", async () => {
            await createKeeps(rewardTimestamps)
            let keepAddress = await keepFactory.getKeepAtIndex(0)
            await expectRevert(
                rewards.reportTermination(keepAddress),
                "Keep is not terminated"
            )
        })

        it("doesn't unallocate closed keeps' rewards", async () => {
            await createKeeps(rewardTimestamps)
            let keepAddress = await keepFactory.getKeepAtIndex(0)
            let keep = await RewardsKeepStub.at(keepAddress)
            await keep.close()
            await expectRevert(
                rewards.reportTermination(keepAddress),
                "Keep is not terminated"
            )
        })

        it("doesn't unallocate unrecognized keeps' rewards", async () => {
            await createKeeps(rewardTimestamps)
            let fakeKeepAddress = accounts[8]
            await expectRevert(
                rewards.reportTermination(fakeKeepAddress),
                "Keep address not recognized by factory"
            )
        })
    })
})
