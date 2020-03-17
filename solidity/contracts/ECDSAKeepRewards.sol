pragma solidity ^0.5.4;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";

/// @title ECDSAKeepRewards
/// @dev A contract for distributing KEEP token rewards to ECDSA keeps.
/// When a reward contract is created,
/// the creator defines a reward schedule
/// consisting of one or more reward intervals and their interval weights,
/// the length of reward intervals,
/// and the quota of how many keeps must be created in an interval
/// for the full reward for that interval to be paid out.
///
/// The amount of KEEP to be distributed is determined by funding the contract,
/// and additional KEEP can be added at any time.
/// The reward contract is funded with `approveAndCall` with no extra data,
/// but it also collects any KEEP mistakenly sent to it in any other way.
///
/// An interval is defined by the timestamps [startOf, endOf);
/// a keep created at the time `startOf(i)` belongs to interval `i`
/// and one created at `endOf(i)` belongs to `i+1`.
///
/// When an interval is over,
/// it will be allocated a percentage of the remaining unallocated rewards
/// based on its weight,
/// and adjusted by the number of keeps created in the interval
/// if the quota is not met.
/// The adjustment for not meeting the keep quota is a percentage
/// that equals the percentage of the quota that was met;
/// if the number of keeps created is 80% of the quota
/// then 80% of the base reward will be allocated for the interval.
///
/// Any unallocated rewards will stay in the unallocated rewards pool,
/// to be allocated for future intervals.
/// Intervals past the initially defined schedule have a weight of 100%,
/// meaning that all remaining unallocated rewards
/// will be allocated to the interval.
///
/// ECDSA keeps created by the defined `factory` can receive rewards
/// once the interval they were created in is over,
/// and the keep has closed happily.
/// There is no time limit to receiving rewards,
/// nor is there need to wait for all keeps from the interval to close.
/// Calling `receiveReward` automatically allocates the rewards
/// for the interval the specified keep was created in
/// and all previous intervals.
///
/// If a keep is terminated,
/// that fact can be reported to the reward contract.
/// Reporting a terminated keep returns its allocated reward
/// to the pool of unallocated rewards.
contract ECDSAKeepRewards {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    IERC20 token;
    IBondedECDSAKeepFactory factory;

    // Total number of keep tokens to distribute.
    uint256 totalRewards;
    // Rewards that haven't been allocated to finished intervals
    uint256 unallocatedRewards;
    // Rewards that have been paid out;
    // `token.balanceOf(address(this))` should always equal
    // `totalRewards.sub(paidOutRewards)`
    uint256 paidOutRewards;

    // Length of one interval.
    uint256 termLength;
    // Timestamp of first interval beginning.
    uint256 firstIntervalStart;

    // Minimum number of keep submissions for each interval.
    uint256 minimumKeepsPerInterval;

    // Array representing the percentage of unallocated rewards
    // available for each reward interval.
    uint256[] intervalWeights; // percent array
    // Mapping of interval number to tokens allocated for the interval.
    uint256[] intervalAllocations;

    // Total number of intervals. (Implicit in intervalWeights)
    // uint256 termCount = intervalWeights.length;

    // mapping of keeps to booleans.
    // True if the keep has been used to claim a reward.
    mapping(address => bool) claimed;

    // Array of timestamps marking interval's end.
    uint256[] intervalEndpoints;

    // Mapping of interval to number of keeps created in/before the interval
    mapping(uint256 => uint256) keepsByInterval;

    // Mapping of interval to number of keeps whose rewards have been paid out,
    // or reallocated because the keep closed unhappily
    mapping(uint256 => uint256) intervalKeepsProcessed;

    constructor (
        uint256 _termLength,
        address _token,
        uint256 _minimumKeepsPerInterval,
        address factoryAddress,
        uint256 _firstIntervalStart,
        uint256[] memory _intervalWeights
    )
    public {
       token = IERC20(_token);
       termLength = _termLength;
       firstIntervalStart = _firstIntervalStart;
       minimumKeepsPerInterval = _minimumKeepsPerInterval;
       factory = IBondedECDSAKeepFactory(factoryAddress);
       intervalWeights = _intervalWeights;
    }

    /// @notice `approveAndCall` funds the rewards contract.
    /// @dev Adds the received amount of tokens
    /// to `totalRewards` and `unallocatedRewards`.
    /// May be called at any time, even after allocating some intervals.
    /// Changes to `unallocatedRewards`
    /// will take effect on subsequent interval allocations.
    /// If the reward contract has received tokens outside `approveAndCall`,
    /// this collects them as well.
    function receiveApproval(
        address _from,
        uint256 _value,
        address _token,
        bytes memory
    ) public {
        require(IERC20(_token) == token, "Unsupported token");

        token.safeTransferFrom(_from, address(this), _value);

        uint256 currentBalance = token.balanceOf(address(this));
        uint256 beforeBalance = _unpaidRewards();
        require(
            currentBalance >= beforeBalance,
            "Reward contract has lost tokens"
        );

        uint256 addedBalance = currentBalance.sub(beforeBalance);

        totalRewards += addedBalance;
        unallocatedRewards += addedBalance;
    }

    /// @notice Sends the reward for a keep to the keep members.
    /// @param keepAddress ECDSA keep factory address.
    function receiveReward(address keepAddress)
        factoryMustRecognize(keepAddress)
        rewardsNotClaimed(keepAddress)
        mustBeClosed(keepAddress)
        public
    {
        _processKeep(true, keepAddress);
    }

    function reportTermination(address keepAddress)
        factoryMustRecognize(keepAddress)
        rewardsNotClaimed(keepAddress)
        mustBeTerminated(keepAddress)
        public
    {
        _processKeep(false, keepAddress);
    }

    /// @notice Checks if a keep is eligible to receive rewards.
    /// @dev Keeps that close dishonorably or early are not eligible for rewards.
    /// @param _keep The keep to check.
    /// @return True if the keep is eligible, false otherwise
    function eligibleForReward(address _keep) public view returns (bool){
        bool _claimed = _rewardClaimed(_keep);
        bool closed = _isClosed(_keep);
        bool recognized = _recognizedByFactory(_keep);
        return !_claimed && closed && recognized;
    }

    /// @notice Checks if a keep is terminated
    /// and thus its rewards can be returned to the unallocated pool.
    /// @param _keep The keep to check.
    /// @return True if the keep is terminated, false otherwise
    function eligibleButTerminated(address _keep) public view returns (bool) {
        bool _claimed = _rewardClaimed(_keep);
        bool terminated = _isTerminated(_keep);
        bool recognized = _recognizedByFactory(_keep);
        return !_claimed && terminated && recognized;
    }

    /// @notice Return the interval number
    /// the provided timestamp falls within.
    /// @dev If the timestamp is before `firstIntervalStart`,
    /// the interval is 0.
    /// @param timestamp The timestamp whose interval is queried.
    /// @return The interval of the timestamp.
    function intervalOf(uint256 timestamp) public view returns (uint256) {
        uint256 _firstIntervalStart = firstIntervalStart;
        uint256 _termLength = termLength;

        if (timestamp < _firstIntervalStart) {
            return 0;
        }

        uint256 difference = timestamp - _firstIntervalStart;
        uint256 interval = difference / _termLength;

        return interval;
    }

    /// @notice Return the timestamp corresponding to the start of the interval.
    /// @dev The start of an interval is inclusive;
    /// a keep created at the timestamp `startOf(i)` is in interval `i`.
    function startOf(uint256 interval) public view returns (uint256) {
        return firstIntervalStart + (interval * termLength);
    }

    /// @notice Return the timestamp corresponding to the end of the interval.
    /// @dev The end of an interval is exclusive;
    /// a keep created at the timestamp `endOf(i)` is in interval `i+1`.
    function endOf(uint256 interval) public view returns (uint256) {
        return startOf(interval + 1);
    }

    /// @notice Return the number of keeps created before `intervalEndpoint`
    /// @dev Wraps the binary search of `_find`
    /// with a number of checks for edge cases.
    function _findEndpoint(uint256 intervalEndpoint) public view returns (uint256) {
        require(
            intervalEndpoint <= block.timestamp,
            "interval hasn't ended yet"
        );
        uint256 keepCount = factory.getKeepCount();
        // no keeps created yet -> return 0
        if (keepCount == 0) {
            return 0;
        }

        uint256 lb = 0; // lower bound, inclusive
        uint256 timestampLB = factory.getCreationTime(factory.getKeepAtIndex(lb));
        // all keeps created after the interval -> return 0
        if (timestampLB >= intervalEndpoint) {
            return 0;
        }

        uint256 ub = keepCount - 1; // upper bound, inclusive
        uint256 timestampUB = factory.getCreationTime(factory.getKeepAtIndex(ub));
        // all keeps created in or before the interval -> return keep count
        if (timestampUB < intervalEndpoint) {
            return keepCount;
        }

        // The above cases also cover the case
        // where only 1 keep has been created;
        // lb == ub
        // if it was created after the interval, return 0
        // otherwise, return 1

        return _find(lb, timestampLB, ub, timestampUB, intervalEndpoint);
    }

    /// @notice Return the number of keeps created before `targetTime`,
    /// with specified upper and lower bounds.
    /// @dev Binary search assumes the following invariants:
    ///   lb >= 0, lbTime < targetTime
    ///   ub < keepCount, ubTime >= targetTime
    /// @param lb The lower bound of the search (inclusive)
    /// @param lbTime The creation time of keep number `lb`
    /// @param ub The upper bound of the search (inclusive)
    /// @param ubTime The creation time of keep number `ub`
    /// @param targetTime The target time
    function _find(
        uint256 lb,
        uint256 lbTime,
        uint256 ub,
        uint256 ubTime,
        uint256 targetTime
    ) internal view returns (uint256) {
        uint256 len = ub - lb;
        while (len > 1) {
            // ub >= lb + 2
            // mid > lb
            uint256 mid = lb + (len / 2);
            uint256 midTime = factory.getCreationTime(factory.getKeepAtIndex(mid));

            if (midTime >= targetTime) {
                ub = mid;
                ubTime = midTime;
            } else {
                lb = mid;
                lbTime = midTime;
            }
            len = ub - lb;
        }
        return ub;
    }

   /// @notice Return the endpoint index of the interval,
   /// i.e. the number of keeps created in and before the interval.
   /// The interval must have ended;
   /// otherwise the endpoint might still change.
   /// @dev Uses a locally cached result,
   /// and stores the result if it isn't cached yet.
   /// All keeps created before the initiation fall in interval 0.
   /// @param interval The number of the interval.
   /// @return endpoint The number of keeps the factory had created
   /// before the end of the interval.
   function _getEndpoint(uint256 interval)
       mustBeFinished(interval)
       internal
       returns (uint256 endpoint)
   {
       // Get the endpoint from local cache;
       // might not be recorded yet
       uint256 maybeEndpoint = keepsByInterval[interval];

       // Either the endpoint is zero
       // (no keeps created by the end of the interval)
       // or the endpoint isn't cached yet
       if (maybeEndpoint == 0) {
           // Check what the real endpoint is
           // if the actual value is 0, this call short-circuits
           // so we don't need to special-case the zero
           uint256 realEndpoint = _findEndpoint(endOf(interval));
           // We didn't have the correct value cached,
           // so store it
           if (realEndpoint != 0) {
               keepsByInterval[interval] = realEndpoint;
           }
           endpoint = realEndpoint;
       } else {
           endpoint = maybeEndpoint;
       }
       return endpoint;
   }

   function _getPreviousEndpoint(uint256 interval) internal returns (uint256) {
       if (interval == 0) {
           return 0;
       } else {
           return _getEndpoint(interval - 1);
       }
   }

   function _keepsInInterval(uint256 interval) internal returns (uint256) {
       return (_getEndpoint(interval) - _getPreviousEndpoint(interval));
   }

   /// @notice Calculate the reward allocation adjustment percentage
   /// when an interval has an insufficient number of keeps.
   /// @dev An interval with at least `minimumKeepsPerInterval` keeps
   /// will have the full reward allocated to it.
   /// An interval with fewer keeps will only be allocated
   /// a fraction of the base reward
   /// equaling the fraction of the quota that was met.
   function _keepCountAdjustment(uint256 interval) internal returns (uint256) {
       uint256 minimumKeeps = minimumKeepsPerInterval;
       uint256 keepCount = _keepsInInterval(interval);
       if (keepCount >= minimumKeeps) {
           return 100;
       } else {
           return keepCount.mul(100).div(minimumKeeps);
       }
   }

   /// @notice Return the percentage of remaining unallocated rewards
   /// that is to be allocated to the specified `interval`
   function _getIntervalWeight(uint256 interval) internal view returns (uint256) {
       if (interval < _getIntervalCount()) {
           return intervalWeights[interval];
       } else {
           return 100;
       }
   }

   function _getIntervalCount() internal view returns (uint256) {
       return intervalWeights.length;
   }

   function _baseAllocation(uint256 interval) internal view returns (uint256) {
       uint256 _unallocatedRewards = unallocatedRewards;
       uint256 weightPercentage = _getIntervalWeight(interval);
       return _unallocatedRewards.mul(weightPercentage).div(100);
   }

   function _adjustedAllocation(uint256 interval) internal returns (uint256) {
       uint256 __baseAllocation = _baseAllocation(interval);
       uint256 adjustmentPercentage = _keepCountAdjustment(interval);
       return __baseAllocation.mul(adjustmentPercentage).div(100);
   }

   function _rewardPerKeep(uint256 interval) internal returns (uint256) {
       uint256 __adjustedAllocation = _adjustedAllocation(interval);
       if (__adjustedAllocation == 0) {
           return 0;
       }
       uint256 keepCount = _keepsInInterval(interval);
       // Adjusted allocation would be zero if keep count was zero
       assert(keepCount > 0);
       return __adjustedAllocation.div(keepCount);
   }

   function _allocateRewards(uint256 interval)
       mustBeFinished(interval)
       internal
   {
       uint256 allocatedIntervals = intervalAllocations.length;
       require(
           !(interval < allocatedIntervals),
           "Interval already allocated"
       );
       // Allocate previous intervals first
       if (interval > allocatedIntervals) {
           _allocateRewards(interval - 1);
       }
       uint256 keepCount = _keepsInInterval(interval);
       uint256 perKeepAllocation = _rewardPerKeep(interval);
       // Calculate like this so rewards divide equally among keeps
       uint256 totalAllocation = keepCount * perKeepAllocation;
       unallocatedRewards -= totalAllocation;
       intervalAllocations.push(totalAllocation);
   }

   function _getAllocatedRewards(uint256 interval) internal view returns (uint256) {
       require(
           interval < intervalAllocations.length,
           "Interval not allocated yet"
       );
       return intervalAllocations[interval];
   }

   function _isAllocated(uint256 interval) internal view returns (bool) {
       uint256 allocatedIntervals = intervalAllocations.length;
       return (interval < allocatedIntervals);
   }

   function _processKeep(
       bool eligible,
       address keepAddress
   ) internal {
       uint256 creationTime = factory.getCreationTime(keepAddress);
       uint256 interval = intervalOf(creationTime);
       if (!_isAllocated(interval)) {
           _allocateRewards(interval);
       }
       uint256 allocation = intervalAllocations[interval];
       uint256 __keepsInInterval = _keepsInInterval(interval);
       uint256 perKeepReward = allocation.div(__keepsInInterval);
       uint256 processedKeeps = intervalKeepsProcessed[interval];
       claimed[keepAddress] = true;
       intervalKeepsProcessed[interval] = processedKeeps + 1;

       if (eligible) {
           paidOutRewards += perKeepReward;
           token.approve(keepAddress, perKeepReward);
           IBondedECDSAKeep(keepAddress).distributeERC20Reward(
               address(token),
               perKeepReward
           );
       } else {
           // Return the reward to the unallocated pool
           unallocatedRewards += perKeepReward;
       }
   }

   function _unpaidRewards() internal view returns (uint256) {
       return totalRewards.sub(paidOutRewards);
   }

   function _rewardClaimed(address _keep) internal view returns (bool) {
       return claimed[_keep];
   }
   function _isClosed(address _keep) internal view returns (bool) {
       return IBondedECDSAKeep(_keep).isClosed();
   }
   function _isTerminated(address _keep) internal view returns (bool) {
       return IBondedECDSAKeep(_keep).isTerminated();
   }
   function _recognizedByFactory(address _keep) internal view returns (bool) {
       return factory.getCreationTime(_keep) != 0;
   }
   function _isFinished(uint256 interval) internal view returns (bool) {
       return block.timestamp >= endOf(interval);
   }

   modifier rewardsNotClaimed(address _keep) {
       require(
           !_rewardClaimed(_keep),
           "Rewards already claimed");
       _;
   }

   modifier mustBeFinished(uint256 interval) {
       require(
           _isFinished(interval),
           "Interval hasn't ended yet");
       _;
   }

   modifier mustBeClosed(address _keep) {
       require(
           _isClosed(_keep),
           "Keep is not closed");
       _;
   }

   modifier mustBeTerminated(address _keep) {
       require(
           _isTerminated(_keep),
           "Keep is not terminated");
       _;
   }

   modifier factoryMustRecognize(address _keep) {
       require(
           _recognizedByFactory(_keep),
           "Keep address not recognized by factory");
       _;
   }
}

interface IBondedECDSAKeep {
    function getOwner() external view returns (address);
    function getTimestamp() external view returns (uint256);
    function isClosed() external view returns (bool);
    function isTerminated() external view returns (bool);
    function isActive() external view returns (bool);
    function distributeERC20Reward(address _erc20, uint256 amount) external;
}

interface IBondedECDSAKeepFactory {
    function getKeepCount() external view returns (uint256);
    function getKeepAtIndex(uint256 index) external view returns (address);
    function getCreationTime(address _keep) external view returns (uint256);
}