package ethereum

import (
	"context"
	"fmt"
	"math/big"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
	chain "github.com/keep-network/keep-tecdsa/pkg/chain/eth"
)

type ethereumBlockCounter struct {
	structMutex         sync.Mutex
	latestBlockHeight   uint64
	subscriptionChannel chan *big.Int
	waiters             map[uint64][]chan uint64
	watchers            []*watcher
}

type watcher struct {
	ctx     context.Context
	channel chan uint64
}

func (ebc *ethereumBlockCounter) WatchBlocks(ctx context.Context) <-chan uint64 {
	watcher := &watcher{
		ctx:     ctx,
		channel: make(chan uint64),
	}

	ebc.structMutex.Lock()
	ebc.watchers = append(ebc.watchers, watcher)
	ebc.structMutex.Unlock()

	go func() {
		<-ctx.Done()

		ebc.structMutex.Lock()
		for i, w := range ebc.watchers {
			if w == watcher {
				ebc.watchers[i] = ebc.watchers[len(ebc.watchers)-1]
				ebc.watchers = ebc.watchers[:len(ebc.watchers)-1]
				break
			}
		}
		ebc.structMutex.Unlock()
	}()

	return watcher.channel
}

// receiveBlocks gets each new block back from Geth and extracts the
// block height (topBlockNumber) form it. For each block height that is being
// waited on a message will be sent.
func (ebc *ethereumBlockCounter) receiveBlocks() {
	for block := range ebc.subscriptionChannel {
		topBlockNumber := block

		// receivedBlockHeight is the current blockchain height as just
		// received in the notification. latestBlockHeightSeen is the
		// blockchain height as observed in the previous invocation of
		// receiveBlocks().
		//
		// If we have already received notification about this block,
		// we do nothing. All handlers were already called for this block
		// height.
		receivedBlockHeight := topBlockNumber.Uint64()
		if receivedBlockHeight == ebc.latestBlockHeight {
			continue
		}

		// We have already seen latestBlockHeightSeen during the previous
		// execution of receiveBlocks() function and all handlers for
		// latestBlockHeightSeen were called. Now we start from the next block
		// after it and that's latestBlockHeightSeen + 1.
		for unseenBlockNumber := ebc.latestBlockHeight + 1; unseenBlockNumber <= receivedBlockHeight; unseenBlockNumber++ {
			ebc.structMutex.Lock()
			height := unseenBlockNumber
			ebc.latestBlockHeight++
			waiters := ebc.waiters[height]
			delete(ebc.waiters, height)
			ebc.structMutex.Unlock()

			for _, waiter := range waiters {
				go func(w chan uint64) { w <- height }(waiter)
			}

			ebc.structMutex.Lock()
			watchers := make([]*watcher, len(ebc.watchers))
			copy(watchers, ebc.watchers)
			ebc.structMutex.Unlock()

			for _, watcher := range watchers {
				if watcher.ctx.Err() != nil {
					close(watcher.channel)
					continue
				}

				select {
				case watcher.channel <- height: // perfect
				default: // we don't care, let's drop it
				}
			}
		}
	}
}

// subscribeBlocks creates a subscription to Geth to get each block.
func (ebc *ethereumBlockCounter) subscribeBlocks(ctx context.Context, client *ethclient.Client) error {
	errorChan := make(chan error)
	newBlockChan := make(chan *types.Header)

	subscribe := func() {
		logger.Debugf("subscribing to new blocks")

		subscribeContext, cancel := context.WithTimeout(
			ctx,
			10*time.Second, // timeout for subscription request
		)
		defer cancel()

		subscription, err := client.SubscribeNewHead(
			subscribeContext,
			newBlockChan,
		)
		if err != nil {
			logger.Warningf("could not create subscription to new blocks: [%v]", err)
			errorChan <- err
			return
		}

		for {
			select {
			case header := <-newBlockChan:
				ebc.subscriptionChannel <- header.Number
			case err = <-subscription.Err():
				logger.Warningf("subscription to new blocks interrupted: [%v]", err)
				subscription.Unsubscribe()
				errorChan <- err
				return
			}
		}

	}

	go func() {
		for {
			go subscribe()
			<-errorChan
			time.Sleep(5 * time.Second)
		}
	}()

	lastBlock, err := client.BlockByNumber(
		ctx,
		nil, // if `nil` then latest known block is returned
	)
	if err != nil {
		return err
	}

	ebc.subscriptionChannel <- lastBlock.Number()

	return nil
}

// BlockCounter creates a BlockCounter that uses the block number in ethereum.
func (ec *EthereumChain) BlockCounter() (chain.BlockCounter, error) {
	return ec.ethereumBlockCounter, nil
}

func createBlockCounter(client *ethclient.Client) (*ethereumBlockCounter, error) {
	ctx := context.Background()

	startupBlock, err := client.BlockByNumber(
		ctx,
		nil, // if `nil` then latest known block is returned
	)
	if err != nil {
		return nil,
			fmt.Errorf(
				"failed to get initial block from the chain: [%v]",
				err,
			)
	}

	blockCounter := &ethereumBlockCounter{
		latestBlockHeight:   startupBlock.Number().Uint64(),
		waiters:             make(map[uint64][]chan uint64),
		subscriptionChannel: make(chan *big.Int),
	}

	go blockCounter.receiveBlocks()
	err = blockCounter.subscribeBlocks(ctx, client)
	if err != nil {
		return nil, fmt.Errorf("failed to subscribe to new blocks: [%v]", err)
	}

	return blockCounter, nil
}
