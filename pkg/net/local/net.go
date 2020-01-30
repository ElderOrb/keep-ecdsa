package local

import (
	"encoding/hex"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ipfs/go-log"

	"github.com/keep-network/keep-core/pkg/net/key"
	brdcLocal "github.com/keep-network/keep-core/pkg/net/local"
	"github.com/keep-network/keep-tecdsa/pkg/net"
)

var logger = log.Logger("keep-net")

type localProvider struct {
	transportID       localIdentifier
	broadcastProvider net.BroadcastProvider
	unicastProvider   *unicastProvider
}

// LocalProvider returns local implementation of net.Provider which can be used
// for testing.
func LocalProvider(
	publicKey *key.NetworkPublic, // node's public key
) net.Provider {
	return &localProvider{
		broadcastProvider: brdcLocal.ConnectWithKey(publicKey),
		unicastProvider:   unicastConnectWithKey(publicKey),
	}
}

func (p *localProvider) BroadcastChannelFor(name string) (net.BroadcastChannel, error) {
	return p.broadcastProvider.ChannelFor(name)
}

func (p *localProvider) UnicastChannelWith(name string) (net.UnicastChannel, error) {
	return p.unicastProvider.ChannelFor(name)
}

type localIdentifier string

func (li localIdentifier) String() string {
	return string(li)
}

func localIdentifierFromNetworkKey(publicKey *key.NetworkPublic) localIdentifier {
	ethereumAddress := key.NetworkPubKeyToEthAddress(publicKey)
	return localIdentifier(hex.EncodeToString(common.FromHex(ethereumAddress)))
}
