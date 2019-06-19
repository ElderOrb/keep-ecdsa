package local

import (
	"github.com/ethereum/go-ethereum/common"
	"github.com/keep-network/keep-tecdsa/pkg/chain/eth"
)

func (c *localChain) createKeep(keepAddress common.Address) {
	c.handlerMutex.Lock()
	defer c.handlerMutex.Unlock()

	localKeep := &localKeep{
		signatureRequestedHandlers: make(map[int]func(keepCreated *eth.SignatureRequestedEvent)),
		publicKey: [64]byte{},
	}
	c.keeps[keepAddress] = localKeep

	keepCreatedEvent := &eth.ECDSAKeepCreatedEvent{
		KeepAddress: keepAddress,
	}

	for _, handler := range c.keepCreatedHandlers {
		go func(handler func(event *eth.ECDSAKeepCreatedEvent), keepCreatedEvent *eth.ECDSAKeepCreatedEvent) {
			handler(keepCreatedEvent)
		}(handler, keepCreatedEvent)
	}
}
