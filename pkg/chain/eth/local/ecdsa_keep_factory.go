package local

import (
	"fmt"

	"github.com/ethereum/go-ethereum/common"
	"github.com/keep-network/keep-tecdsa/pkg/chain/eth"
)

func (c *LocalChain) CreateKeep(
	keepAddress eth.KeepAddress,
	members []common.Address,
) error {
	c.handlerMutex.Lock()
	defer c.handlerMutex.Unlock()

	if _, ok := c.keeps[keepAddress]; ok {
		return fmt.Errorf(
			"keep already exists for address [%s]",
			keepAddress.String(),
		)
	}

	localKeep := &localKeep{
		signatureRequestedHandlers: make(map[int]func(event *eth.SignatureRequestedEvent)),
		publicKey:                  [64]byte{},
	}
	c.keeps[keepAddress] = localKeep

	keepCreatedEvent := &eth.ECDSAKeepCreatedEvent{
		KeepAddress: keepAddress,
		Members:     members,
	}

	for _, handler := range c.keepCreatedHandlers {
		go func(handler func(event *eth.ECDSAKeepCreatedEvent), keepCreatedEvent *eth.ECDSAKeepCreatedEvent) {
			handler(keepCreatedEvent)
		}(handler, keepCreatedEvent)
	}

	return nil
}
